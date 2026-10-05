import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '../../../domain/interfaces/logger.interface.js';
import type { AuthContext } from '../../auth/auth-context.js';
import { HttpError, matchId, readJson, sendError, sendJson, type ModuleRouter } from '../../http/module-http.js';
import { PropertyNotFound, PropertyValidationError } from '../application/property.service.js';
import {
  ProposalNotFound,
  ProposalPropertyLocked,
  type ProposalPropertyService,
} from '../application/proposal-property.service.js';

/**
 * Imóvel da proposta (seção 13). Fica fora do servidor antigo de propostas:
 * só com JWT, e a empresa vem do token.
 */
export class ProposalPropertyRouter implements ModuleRouter {
  constructor(
    private readonly service: ProposalPropertyService,
    private readonly logger: Logger,
  ) {}

  async handle(request: IncomingMessage, response: ServerResponse, url: URL, context: AuthContext): Promise<boolean> {
    const proposalId = matchId(url.pathname, '/api/proposals/', '/property');
    const method = request.method ?? 'GET';

    if (!proposalId) return false;

    try {
      if (method === 'GET') {
        sendJson(response, 200, { ok: true, ...(await this.service.view(context, proposalId)) });
        return true;
      }

      if (method === 'PUT') {
        const body = await readJson(request);
        const propertyId = body.propertyId;

        if (propertyId !== null && typeof propertyId !== 'string') {
          throw new HttpError(422, 'Escolha um imóvel', { propertyId: 'Escolha um imóvel' });
        }

        sendJson(response, 200, { ok: true, ...(await this.service.link(context, proposalId, propertyId || null)) });
        return true;
      }

      throw new HttpError(405, 'Método não permitido');
    } catch (error) {
      sendError(response, translate(error), this.logger, `${method} ${url.pathname}`);
      return true;
    }
  }
}

/** Imóvel ou proposta de outra empresa respondem 404, sem revelar nada (CA-13.13). */
function translate(error: unknown): unknown {
  if (error instanceof ProposalNotFound) return new HttpError(404, error.message);
  if (error instanceof PropertyNotFound) return new HttpError(404, error.message);
  if (error instanceof ProposalPropertyLocked) return new HttpError(403, error.message);
  if (error instanceof PropertyValidationError) return new HttpError(422, error.message, error.fields);

  return error;
}
