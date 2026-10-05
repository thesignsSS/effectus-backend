import type { Logger } from '../../../domain/interfaces/logger.interface.js';
import type { AuthContext } from '../../auth/auth-context.js';
import { requireActiveCompany } from '../../auth/permissions.js';
import type { PhotoStorage, PropertyPhotoRepository } from '../domain/property-photo-ports.js';
import { propertyPolicy } from '../domain/property-policy.js';
import type { Property } from '../domain/property.js';
import type { PropertyRepository, PropertyUsage } from '../domain/property-repository.js';
import { PropertyNotFound, PropertyValidationError } from './property.service.js';

export class PropertyHasHistory extends Error {
  constructor() {
    super('Este imóvel tem histórico e não pode ser excluído. Você pode inativá-lo.');
    this.name = 'PropertyHasHistory';
  }
}

/** O que a tela precisa para oferecer Excluir ou Inativar (15.1, 15.2) e confirmar (15.4). */
export type LifecycleOptions = PropertyUsage & {
  canDelete: boolean;
  canInactivate: boolean;
  canTransfer: boolean;
};

/**
 * Seção 15: excluir (só sem histórico), inativar e transferir. Também passa
 * os imóveis de um corretor que sai da empresa para o dono do plano
 * (decisão 10, substitui a regra 15.9).
 */
export class PropertyLifecycleService {
  constructor(
    private readonly properties: PropertyRepository,
    private readonly photos: PropertyPhotoRepository,
    private readonly storage: PhotoStorage,
    private readonly logger: Logger,
  ) {}

  async options(context: AuthContext, id: string): Promise<LifecycleOptions> {
    const property = await this.load(context, id);
    propertyPolicy.assert(context, 'view', property);

    const usage = await this.properties.usage(property.companyId, property.id);
    const hasHistory = usage.proposals > 0 || usage.engineeringRequests > 0;
    const canManage = propertyPolicy.can(context, 'deleteOrInactivate', property);

    return {
      ...usage,
      canDelete: canManage && !hasHistory,
      canInactivate: canManage && hasHistory && property.status !== 'inativo',
      canTransfer: propertyPolicy.can(context, 'transfer', property),
    };
  }

  /** 15.1: exclusão definitiva, só sem proposta nem engenharia; as fotos saem do Storage. */
  async delete(context: AuthContext, id: string): Promise<void> {
    const property = await this.load(context, id);
    propertyPolicy.assert(context, 'deleteOrInactivate', property);

    const photos = await this.photos.list(property.companyId, property.id);
    const result = await this.properties.deleteIfUnused(property.companyId, property.id);

    if (result === 'not_found') throw new PropertyNotFound();
    if (result === 'has_history') throw new PropertyHasHistory();

    await Promise.all(
      photos.map((photo) =>
        this.storage.remove(photo.storagePath).catch((error: unknown) =>
          this.logger.warn('Foto de imóvel excluído não removida do Storage', {
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
      ),
    );

    this.logger.info('Imóvel excluído', { propertyId: property.id, by: context.userId });
  }

  /**
   * 15.7 e 15.8: só o ADM, um ou vários imóveis, para outro corretor ativo
   * da mesma empresa. Situação não muda; propostas mantêm seus corretores.
   */
  async transfer(context: AuthContext, input: { propertyIds?: unknown; toBrokerId?: unknown }): Promise<{ transferred: number }> {
    const companyId = requireActiveCompany(context);
    const ids = Array.isArray(input.propertyIds) ? [...new Set(input.propertyIds.filter((id): id is string => typeof id === 'string'))] : [];
    const toBrokerId = typeof input.toBrokerId === 'string' ? input.toBrokerId : '';

    if (ids.length === 0) throw new PropertyValidationError({ propertyIds: 'Escolha ao menos um imóvel' });

    const target = await this.properties.findBroker(companyId, toBrokerId);

    if (!target || !target.isActive) {
      throw new PropertyValidationError({ toBrokerId: 'Escolha um corretor ativo desta imobiliária' });
    }

    const properties: Property[] = [];

    for (const id of ids) {
      const property = await this.properties.findById(companyId, id);

      if (!property) throw new PropertyNotFound();

      propertyPolicy.assert(context, 'transfer', property);
      properties.push(property);
    }

    let transferred = 0;

    for (const property of properties) {
      if (property.responsibleBrokerId === target.id) continue;

      await this.moveTo(property, target.id, context.userId);
      transferred += 1;
    }

    return { transferred };
  }

  /**
   * Decisão 10: corretor que sai da empresa tem os imóveis passados ao dono
   * do plano, registrados como "Sistema". Roda antes de o usuário ser
   * excluído, senão a exclusão esbarraria na referência do responsável.
   */
  async reassignFromDepartingBroker(companyId: string, departingBrokerId: string, ownerId: string): Promise<number> {
    if (departingBrokerId === ownerId) return 0;

    const ids = await this.properties.listIdsByResponsible(companyId, departingBrokerId);

    for (const id of ids) {
      const property = await this.properties.findById(companyId, id);

      if (property) await this.moveTo(property, ownerId, null, 'responsavel_saiu_da_empresa');
    }

    if (ids.length > 0) {
      this.logger.info('Imóveis passados ao dono do plano', { companyId, count: ids.length });
    }

    return ids.length;
  }

  private async moveTo(property: Property, toBrokerId: string, actorId: string | null, reason?: string) {
    await this.properties.update(property.companyId, property.id, {
      responsibleBrokerId: toBrokerId,
      updatedBy: actorId,
    });
    await this.properties.addEvent({
      companyId: property.companyId,
      propertyId: property.id,
      kind: 'transferred',
      actorId,
      data: { from: property.responsibleBrokerId, to: toBrokerId, ...(reason ? { reason } : {}) },
    });
  }

  private async load(context: AuthContext, id: string): Promise<Property> {
    const companyId = requireActiveCompany(context);
    const property = await this.properties.findById(companyId, id);

    if (!property) throw new PropertyNotFound();

    return property;
  }
}
