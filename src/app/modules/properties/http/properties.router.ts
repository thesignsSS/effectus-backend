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
import type { PropertyInput } from '../domain/property.js';

/**
 * Rotas do imóvel (spec BKL-093). A empresa e o papel vêm sempre do token;
 * nenhuma rota aceita `userId` ou `companyId` do cliente.
 */
export class PropertiesRouter implements ModuleRouter {
  constructor(
    private readonly service: PropertyService,
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

      if (method === 'POST' && pathname === '/api/properties') {
        const body = (await readJson(request)) as PropertyInput;
        sendJson(response, 201, { ok: true, property: await this.service.create(context, body) });
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
}

function translate(error: unknown): unknown {
  if (error instanceof PropertyNotFound) return new HttpError(404, error.message);
  if (error instanceof PropertyValidationError) return new HttpError(422, error.message, error.fields);
  if (error instanceof MunicipalitiesUnavailable) return new HttpError(503, error.message);

  return error;
}
