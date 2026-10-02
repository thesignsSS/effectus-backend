import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '../../../domain/interfaces/logger.interface.js';
import type { AuthContext } from '../../auth/auth-context.js';
import { HttpError, matchId, readJson, sendError, sendJson, type ModuleRouter } from '../../http/module-http.js';
import {
  MunicipalitiesUnavailable,
  PropertyNotFound,
  PropertyValidationError,
  type PropertyService,
} from '../application/property.service.js';
import { PhotoNotFound, type PropertyPhotoService } from '../application/property-photo.service.js';
import type { PropertyListService } from '../application/property-list.service.js';
import type { PropertyInput } from '../domain/property.js';

const PHOTO_ROUTE = /^\/api\/properties\/([^/]+)\/photos(?:\/(uploads|[^/]+))?(?:\/(cover))?$/;

/**
 * Rotas do imóvel (spec BKL-093). A empresa e o papel vêm sempre do token;
 * nenhuma rota aceita `userId` ou `companyId` do cliente.
 */
export class PropertiesRouter implements ModuleRouter {
  constructor(
    private readonly service: PropertyService,
    private readonly photoService: PropertyPhotoService,
    private readonly listService: PropertyListService,
    private readonly logger: Logger,
  ) {}

  async handle(request: IncomingMessage, response: ServerResponse, url: URL, context: AuthContext): Promise<boolean> {
    const { pathname } = url;
    const method = request.method ?? 'GET';

    if (!pathname.startsWith('/api/properties') && pathname !== '/api/brokers') return false;

    try {
      if (method === 'GET' && pathname === '/api/brokers') {
        sendJson(response, 200, { ok: true, items: await this.service.listBrokers(context) });
        return true;
      }

      if (method === 'GET' && pathname === '/api/properties/municipalities') {
        const state = url.searchParams.get('state')?.trim().toUpperCase() ?? '';

        if (!/^[A-Z]{2}$/.test(state)) throw new HttpError(400, 'Escolha a UF');

        sendJson(response, 200, { ok: true, items: await this.service.listMunicipalities(context, state) });
        return true;
      }

      if (method === 'GET' && pathname === '/api/properties') {
        const params = url.searchParams;
        const list = (key: string) => params.getAll(key).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);

        sendJson(response, 200, {
          ok: true,
          ...(await this.listService.list(context, {
            search: params.get('q'),
            statuses: list('status'),
            types: list('type'),
            responsibleBrokerId: params.get('responsibleBrokerId'),
            page: Number(params.get('page') ?? 1),
            pageSize: Number(params.get('pageSize') ?? 50),
          })),
        });
        return true;
      }

      if (method === 'POST' && pathname === '/api/properties') {
        const body = (await readJson(request)) as PropertyInput;
        sendJson(response, 201, { ok: true, property: await this.service.create(context, body) });
        return true;
      }

      const photoRoute = pathname.match(PHOTO_ROUTE);
      if (photoRoute) {
        return await this.handlePhotos(request, response, method, photoRoute, context);
      }

      const statusId = matchId(pathname, '/api/properties/', '/status');
      if (method === 'POST' && statusId) {
        const body = await readJson(request);
        sendJson(response, 200, { ok: true, property: await this.service.changeStatus(context, statusId, body.status) });
        return true;
      }

      const historyId = matchId(pathname, '/api/properties/', '/history');
      if (method === 'GET' && historyId) {
        sendJson(response, 200, { ok: true, items: await this.service.history(context, historyId) });
        return true;
      }

      const id = matchId(pathname, '/api/properties/');
      if (id && method === 'GET') {
        sendJson(response, 200, { ok: true, property: await this.service.get(context, id) });
        return true;
      }

      if (id && method === 'PUT') {
        const body = (await readJson(request)) as PropertyInput;
        sendJson(response, 200, { ok: true, property: await this.service.update(context, id, body) });
        return true;
      }

      return false;
    } catch (error) {
      sendError(response, translate(error), this.logger, `${method} ${pathname}`);
      return true;
    }
  }

  /** Seção 11: listar, preparar envio, confirmar envio, trocar capa e remover. */
  private async handlePhotos(
    request: IncomingMessage,
    response: ServerResponse,
    method: string,
    [, rawPropertyId, segment, action]: RegExpMatchArray,
    context: AuthContext,
  ): Promise<boolean> {
    const propertyId = decode(rawPropertyId);

    if (method === 'GET' && !segment) {
      sendJson(response, 200, { ok: true, ...(await this.photoService.list(context, propertyId)) });
      return true;
    }

    if (method === 'POST' && segment === 'uploads' && !action) {
      const body = await readJson(request);
      sendJson(response, 201, { ok: true, upload: await this.photoService.prepareUpload(context, propertyId, body) });
      return true;
    }

    if (method === 'POST' && !segment) {
      const body = await readJson(request);
      sendJson(response, 201, { ok: true, photo: await this.photoService.confirmUpload(context, propertyId, body) });
      return true;
    }

    if (method === 'POST' && segment && action === 'cover') {
      await this.photoService.setCover(context, propertyId, decode(segment));
      sendJson(response, 200, { ok: true });
      return true;
    }

    if (method === 'DELETE' && segment && segment !== 'uploads' && !action) {
      await this.photoService.remove(context, propertyId, decode(segment));
      sendJson(response, 200, { ok: true });
      return true;
    }

    return false;
  }
}

function decode(value: string) {
  return decodeURIComponent(value);
}

function translate(error: unknown): unknown {
  if (error instanceof PhotoNotFound) return new HttpError(404, error.message);
  if (error instanceof PropertyNotFound) return new HttpError(404, error.message);
  if (error instanceof PropertyValidationError) return new HttpError(422, error.message, error.fields);
  if (error instanceof MunicipalitiesUnavailable) return new HttpError(503, error.message);

  return error;
}
