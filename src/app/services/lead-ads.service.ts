import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  Lead,
  LeadAdCampaign,
  LeadAdsStore,
  LeadStatus,
  MetaConnection,
} from '../domain/interfaces/lead-ads-store.interface.js';
import {
  InstagramMediaItem,
  LeadAdAudience,
  MetaAdsClient,
  MetaCity,
  MetaLeadField,
} from '../domain/interfaces/meta-ads-client.interface.js';
import { Logger } from '../domain/interfaces/logger.interface.js';

export type LeadAdsProvider = 'graph' | 'fake';

export interface LeadAdsServiceConfig {
  provider: LeadAdsProvider;
  appSecret: string;
  webhookVerifyToken?: string;
  privacyPolicyUrl?: string;
  /** Para onde o navegador volta depois do OAuth (tela de captação do app). */
  appReturnUrl: string;
}

export type CreateCampaignInput = {
  userId: string;
  name: string;
  instagramMediaId: string;
  budgetCents: number;
  durationDays: number;
  audience: LeadAdAudience;
};

export type ConnectionStatus = {
  provider: LeadAdsProvider;
  connected: boolean;
  pageName: string | null;
  instagramUsername: string | null;
  connectedAt: string | null;
};

type LeadgenChange = {
  leadgenId: string;
  pageId: string;
  adId: string | null;
  formId: string | null;
};

const STATE_TTL_MS = 15 * 60 * 1000;
const MIN_BUDGET_CENTS = 2_000;
const MAX_BUDGET_CENTS = 10_000_000;

export class LeadAdsService {
  constructor(
    private readonly config: LeadAdsServiceConfig,
    private readonly store: LeadAdsStore,
    private readonly meta: MetaAdsClient,
    private readonly logger: Logger,
  ) {}

  async getConnectionStatus(userId: string): Promise<ConnectionStatus> {
    const companyId = await this.store.resolveOwnerCompanyId(userId);
    const connection = await this.store.getConnection(companyId);

    return {
      provider: this.config.provider,
      connected: Boolean(connection),
      pageName: connection?.pageName ?? null,
      instagramUsername: connection?.instagramUsername ?? null,
      connectedAt: connection?.connectedAt ?? null,
    };
  }

  async getConnectUrl(userId: string): Promise<string> {
    await this.store.resolveOwnerCompanyId(userId);
    return this.meta.getAuthorizationUrl(this.signState(userId));
  }

  /** Nunca lança: sempre devolve para onde mandar o navegador. */
  async completeConnection(input: {
    code?: string | null;
    state?: string | null;
    error?: string | null;
  }): Promise<string> {
    try {
      if (input.error) {
        throw new Error('Autorização cancelada na Meta');
      }

      if (!input.code || !input.state) {
        throw new Error('Retorno da Meta sem code/state');
      }

      const userId = this.verifyState(input.state);
      // Revalida: o usuário pode ter deixado de ser dono enquanto estava na Meta.
      const companyId = await this.store.resolveOwnerCompanyId(userId);
      const account = await this.meta.authorize(input.code);
      await this.meta.subscribePageToLeads(account.pageId, account.pageAccessToken);
      await this.store.saveConnection({ companyId, connectedByUserId: userId, account });

      return this.returnUrl({ meta: 'connected' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao conectar conta da Meta', { error: message });
      return this.returnUrl({ meta: 'error', reason: message });
    }
  }

  async disconnect(userId: string): Promise<void> {
    const companyId = await this.store.resolveOwnerCompanyId(userId);
    await this.store.revokeConnection(companyId);
  }

  async listInstagramMedia(userId: string): Promise<InstagramMediaItem[]> {
    const { connection } = await this.requireConnection(userId);
    return this.meta.listInstagramMedia(connection.instagramBusinessId, connection.userAccessToken);
  }

  async searchCities(userId: string, query: string): Promise<MetaCity[]> {
    const { connection } = await this.requireConnection(userId);
    if (query.trim().length < 2) return [];
    return this.meta.searchCities(query.trim(), connection.userAccessToken);
  }

  async createCampaign(input: CreateCampaignInput): Promise<LeadAdCampaign> {
    this.validateCampaignInput(input);

    if (this.config.provider === 'graph' && !this.config.privacyPolicyUrl) {
      throw new Error('META_PRIVACY_POLICY_URL não configurada: a Meta exige política de privacidade no formulário de lead');
    }

    const { companyId, connection } = await this.requireConnection(input.userId);

    // Busca o post na conta conectada: garante que o id é mesmo da empresa e
    // traz miniatura/link para mostrar sem chamar a Meta de novo.
    const media = await this.meta.listInstagramMedia(
      connection.instagramBusinessId,
      connection.userAccessToken,
    );
    const post = media.find((item) => item.id === input.instagramMediaId);
    if (!post) {
      throw new Error('Publicação não encontrada entre as últimas do Instagram conectado');
    }

    const startsAt = new Date(Date.now() + 10 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + input.durationDays * 86_400_000);

    const campaign = await this.store.createCampaign({
      companyId,
      createdByUserId: input.userId,
      metaConnectionId: connection.id,
      name: input.name.trim(),
      instagramMediaId: post.id,
      instagramMediaPermalink: post.permalink,
      instagramMediaThumbnailUrl: post.thumbnailUrl,
      instagramMediaCaption: post.caption,
      budgetCents: input.budgetCents,
      durationDays: input.durationDays,
      audience: input.audience,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });

    try {
      const launched = await this.meta.launchLeadAd({
        adAccountId: connection.adAccountId,
        pageId: connection.pageId,
        pageAccessToken: connection.pageAccessToken,
        userAccessToken: connection.userAccessToken,
        instagramBusinessId: connection.instagramBusinessId,
        instagramMediaId: post.id,
        name: campaign.name,
        budgetCents: input.budgetCents,
        startsAt,
        endsAt,
        audience: input.audience,
        privacyPolicyUrl: this.config.privacyPolicyUrl ?? 'https://example.com/privacidade',
      });

      await this.store.markCampaignLaunched({
        campaignId: campaign.id,
        metaCampaignId: launched.campaignId,
        metaAdSetId: launched.adSetId,
        metaCreativeId: launched.creativeId,
        metaAdId: launched.adId,
        metaLeadFormId: launched.leadFormId,
      });
    } catch (error) {
      // A campanha fica registrada como falha (com o motivo) em vez de sumir:
      // o dono vê o que aconteceu e a Meta já foi limpa pelo cliente.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao lançar anúncio na Meta', { campaignId: campaign.id, error: message });
      await this.store.markCampaignFailed(campaign.id, message);
    }

    const saved = await this.store.getCampaign(companyId, campaign.id);
    if (!saved) {
      throw new Error('Campanha não encontrada após criação');
    }

    return saved;
  }

  async listCampaigns(userId: string): Promise<LeadAdCampaign[]> {
    const companyId = await this.store.resolveOwnerCompanyId(userId);
    return this.store.listCampaigns(companyId);
  }

  async getCampaign(
    userId: string,
    campaignId: string,
  ): Promise<{ campaign: LeadAdCampaign; leads: Lead[] }> {
    const companyId = await this.store.resolveOwnerCompanyId(userId);
    const campaign = await this.store.getCampaign(companyId, campaignId);

    if (!campaign) {
      throw new Error('Campanha não encontrada');
    }

    const leads = await this.store.listLeads(companyId, { campaignId });
    return { campaign, leads };
  }

  async listLeads(userId: string, campaignId?: string): Promise<Lead[]> {
    const companyId = await this.store.resolveOwnerCompanyId(userId);
    return this.store.listLeads(companyId, { campaignId });
  }

  async updateLeadStatus(userId: string, leadId: string, status: LeadStatus): Promise<void> {
    const companyId = await this.store.resolveOwnerCompanyId(userId);
    await this.store.updateLeadStatus(companyId, leadId, status);
  }

  /** Handshake do cadastro do webhook no painel da Meta. */
  verifyWebhookSubscription(mode: string | null, token: string | null): boolean {
    return (
      mode === 'subscribe' &&
      Boolean(this.config.webhookVerifyToken) &&
      Boolean(token) &&
      safeEqual(token as string, this.config.webhookVerifyToken as string)
    );
  }

  isValidWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const received = signatureHeader?.match(/^sha256=([a-f0-9]{64})$/i)?.[1];
    if (!received) return false;

    const expected = createHmac('sha256', this.config.appSecret).update(rawBody).digest('hex');
    return safeEqual(received.toLowerCase(), expected);
  }

  async processWebhook(payload: unknown): Promise<void> {
    for (const change of extractLeadgenChanges(payload)) {
      try {
        await this.processLead(change);
      } catch (error) {
        // Um lead com problema não pode impedir os outros do mesmo lote.
        this.logger.error('Falha ao processar lead recebido da Meta', {
          leadgenId: change.leadgenId,
          pageId: change.pageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async processLead(change: LeadgenChange): Promise<void> {
    const connection = await this.store.getConnectionByPageId(change.pageId);
    if (!connection) {
      this.logger.error('Lead recebido de página sem conexão ativa', {
        leadgenId: change.leadgenId,
        pageId: change.pageId,
      });
      return;
    }

    const lead = await this.meta.fetchLead(change.leadgenId, connection.pageAccessToken);
    const adId = lead.adId ?? change.adId;
    const campaignId = adId
      ? await this.store.findCampaignIdByMetaAdId(connection.companyId, adId)
      : null;

    await this.store.saveIncomingLead({
      companyId: connection.companyId,
      campaignId,
      metaLeadgenId: lead.id,
      metaFormId: lead.formId ?? change.formId,
      metaAdId: adId,
      fullName: readLeadField(lead.fields, ['full_name']) ?? joinName(lead.fields),
      email: readLeadField(lead.fields, ['email']),
      phone: readLeadField(lead.fields, ['phone_number', 'phone']),
      fields: lead.fields,
      receivedAt: lead.createdTime,
    });

    this.logger.info('Lead da Meta registrado', {
      leadgenId: lead.id,
      companyId: connection.companyId,
      campaignId,
    });
  }

  private async requireConnection(
    userId: string,
  ): Promise<{ companyId: string; connection: MetaConnection }> {
    const companyId = await this.store.resolveOwnerCompanyId(userId);
    const connection = await this.store.getConnection(companyId);

    if (!connection) {
      throw new Error('Instagram não conectado: conecte a conta da Meta antes de continuar');
    }

    return { companyId, connection };
  }

  private validateCampaignInput(input: CreateCampaignInput): void {
    if (!input.name.trim() || input.name.trim().length > 120) {
      throw new Error('Nome da campanha inválido (1 a 120 caracteres)');
    }

    if (!Number.isInteger(input.budgetCents) || input.budgetCents < MIN_BUDGET_CENTS || input.budgetCents > MAX_BUDGET_CENTS) {
      throw new Error('Orçamento inválido: mínimo de R$ 20,00 e máximo de R$ 100.000,00');
    }

    if (!Number.isInteger(input.durationDays) || input.durationDays < 1 || input.durationDays > 90) {
      throw new Error('Duração inválida: de 1 a 90 dias');
    }

    const { audience } = input;
    if (
      !Number.isInteger(audience.ageMin) ||
      !Number.isInteger(audience.ageMax) ||
      audience.ageMin < 18 ||
      audience.ageMax > 65 ||
      audience.ageMin > audience.ageMax
    ) {
      throw new Error('Faixa de idade inválida: entre 18 e 65 anos');
    }

    if (audience.city && (audience.city.radiusKm < 1 || audience.city.radiusKm > 80)) {
      throw new Error('Raio inválido: de 1 a 80 km');
    }

    if (!audience.city && audience.countries.length === 0) {
      throw new Error('Localização obrigatória: escolha uma cidade ou o país');
    }
  }

  /** `state` do OAuth: prova que o retorno da Meta foi iniciado por este usuário. */
  private signState(userId: string): string {
    const payload = Buffer.from(
      JSON.stringify({ u: userId, e: Date.now() + STATE_TTL_MS, n: randomBytes(8).toString('hex') }),
    ).toString('base64url');

    return `${payload}.${this.hmac(payload)}`;
  }

  private verifyState(state: string): string {
    const [payload, signature] = state.split('.');

    if (!payload || !signature || !safeEqual(signature, this.hmac(payload))) {
      throw new Error('State do OAuth inválido');
    }

    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      u?: string;
      e?: number;
    };

    if (!parsed.u || !parsed.e || parsed.e < Date.now()) {
      throw new Error('State do OAuth expirado: tente conectar de novo');
    }

    return parsed.u;
  }

  private hmac(value: string): string {
    return createHmac('sha256', this.config.appSecret).update(`oauth-state:${value}`).digest('base64url');
  }

  private returnUrl(params: Record<string, string>): string {
    const url = new URL(this.config.appReturnUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value.slice(0, 300));
    }
    return url.toString();
  }
}

function extractLeadgenChanges(payload: unknown): LeadgenChange[] {
  const entries = (payload as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return [];

  const changes: LeadgenChange[] = [];

  for (const entry of entries) {
    const entryChanges = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(entryChanges)) continue;

    for (const change of entryChanges) {
      const { field, value } = change as {
        field?: string;
        value?: { leadgen_id?: string | number; page_id?: string | number; ad_id?: string | number; form_id?: string | number };
      };

      if (field !== 'leadgen' || !value?.leadgen_id || !value.page_id) continue;

      changes.push({
        leadgenId: String(value.leadgen_id),
        pageId: String(value.page_id),
        adId: value.ad_id ? String(value.ad_id) : null,
        formId: value.form_id ? String(value.form_id) : null,
      });
    }
  }

  return changes;
}

function readLeadField(fields: MetaLeadField[], names: string[]): string | null {
  const field = fields.find((item) => names.includes(item.name.toLowerCase()));
  return field?.values[0]?.trim() || null;
}

function joinName(fields: MetaLeadField[]): string | null {
  const first = readLeadField(fields, ['first_name']);
  const last = readLeadField(fields, ['last_name']);
  return [first, last].filter(Boolean).join(' ') || null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
