import { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { Logger } from '../../domain/interfaces/logger.interface.js';
import { LEAD_STATUS_OPTIONS, LeadStatus } from '../../domain/interfaces/lead-ads-store.interface.js';
import { LeadAdAudience } from '../../domain/interfaces/meta-ads-client.interface.js';
import { LeadAdsService } from '../../services/lead-ads.service.js';
import { MetaApiError } from '../meta/graph-meta-ads.client.js';
import { EMPRESA_SUSPENSA } from '../supabase/company-scope.js';

const PREFIX = '/api/lead-ads';
const MAX_BODY_BYTES = 1024 * 1024;

type JsonObject = Record<string, unknown>;

/**
 * Rotas da captação de leads. `service` indefinido = integração desligada
 * neste ambiente (META_ADS_PROVIDER=disabled).
 */
export class LeadAdsHttpHandler {
  constructor(
    private readonly service: LeadAdsService | undefined,
    private readonly logger: Logger,
  ) {}

  /** Rotas chamadas pela Meta ou pelo navegador vindo da Meta: sem API key. */
  async handlePublic(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (!url.pathname.startsWith(`${PREFIX}/meta/`)) return false;

    if (!this.service) {
      sendJson(response, 404, { ok: false, error: 'Captação de leads desativada' });
      return true;
    }

    if (url.pathname === `${PREFIX}/meta/webhook` && request.method === 'GET') {
      const valid = this.service.verifyWebhookSubscription(
        url.searchParams.get('hub.mode'),
        url.searchParams.get('hub.verify_token'),
      );
      response.writeHead(valid ? 200 : 403, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(valid ? (url.searchParams.get('hub.challenge') ?? '') : 'forbidden');
      return true;
    }

    if (url.pathname === `${PREFIX}/meta/webhook` && request.method === 'POST') {
      await this.receiveWebhook(request, response);
      return true;
    }

    if (url.pathname === `${PREFIX}/meta/callback` && request.method === 'GET') {
      const location = await this.service.completeConnection({
        code: url.searchParams.get('code'),
        state: url.searchParams.get('state'),
        error: url.searchParams.get('error'),
      });
      response.writeHead(302, { Location: location });
      response.end();
      return true;
    }

    return false;
  }

  /** Rotas do app. O servidor principal só chama isto depois de validar a API key. */
  async handleAuthorized(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (!url.pathname.startsWith(`${PREFIX}/`)) return false;

    if (!this.service) {
      sendJson(response, 503, {
        ok: false,
        error: 'Captação de leads não está configurada neste ambiente',
      });
      return true;
    }

    const service = this.service;
    const path = url.pathname.slice(PREFIX.length);
    const method = request.method ?? 'GET';

    try {
      if (method === 'GET' && path === '/connection') {
        sendJson(response, 200, await service.getConnectionStatus(requiredParam(url, 'userId')));
        return true;
      }

      if (method === 'DELETE' && path === '/connection') {
        await service.disconnect(requiredParam(url, 'userId'));
        sendJson(response, 200, { ok: true });
        return true;
      }

      if (method === 'GET' && path === '/connect-url') {
        sendJson(response, 200, { url: await service.getConnectUrl(requiredParam(url, 'userId')) });
        return true;
      }

      if (method === 'GET' && path === '/instagram-media') {
        sendJson(response, 200, {
          items: await service.listInstagramMedia(requiredParam(url, 'userId')),
        });
        return true;
      }

      if (method === 'GET' && path === '/cities') {
        sendJson(response, 200, {
          items: await service.searchCities(
            requiredParam(url, 'userId'),
            url.searchParams.get('q') ?? '',
          ),
        });
        return true;
      }

      if (method === 'GET' && path === '/campaigns') {
        sendJson(response, 200, { items: await service.listCampaigns(requiredParam(url, 'userId')) });
        return true;
      }

      if (method === 'POST' && path === '/campaigns') {
        const body = await readJson(request);
        const campaign = await service.createCampaign({
          userId: requiredString(body, 'userId'),
          name: requiredString(body, 'name'),
          instagramMediaId: requiredString(body, 'instagramMediaId'),
          budgetCents: requiredNumber(body, 'budgetCents'),
          durationDays: requiredNumber(body, 'durationDays'),
          audience: parseAudience(body.audience),
        });
        sendJson(response, 201, campaign);
        return true;
      }

      const campaignMatch = path.match(/^\/campaigns\/([^/]+)$/);
      if (method === 'GET' && campaignMatch) {
        sendJson(
          response,
          200,
          await service.getCampaign(requiredParam(url, 'userId'), decodeURIComponent(campaignMatch[1])),
        );
        return true;
      }

      if (method === 'GET' && path === '/leads') {
        sendJson(response, 200, {
          items: await service.listLeads(
            requiredParam(url, 'userId'),
            url.searchParams.get('campaignId')?.trim() || undefined,
          ),
        });
        return true;
      }

      const leadMatch = path.match(/^\/leads\/([^/]+)$/);
      if (method === 'PATCH' && leadMatch) {
        const body = await readJson(request);
        const status = requiredString(body, 'status');
        if (!(LEAD_STATUS_OPTIONS as readonly string[]).includes(status)) {
          throw new Error('Status de lead inválido');
        }
        await service.updateLeadStatus(
          requiredString(body, 'userId'),
          decodeURIComponent(leadMatch[1]),
          status as LeadStatus,
        );
        sendJson(response, 200, { ok: true });
        return true;
      }

      sendJson(response, 404, { ok: false, error: 'Rota não encontrada' });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = statusFromError(error, message);
      if (status >= 500) {
        this.logger.error('Falha na captação de leads', { path, method, error: message });
      }
      sendJson(response, status, { ok: false, error: message });
      return true;
    }
  }

  private async receiveWebhook(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const service = this.service as LeadAdsService;
    let rawBody: Buffer;

    try {
      rawBody = await readRaw(request);
    } catch {
      sendJson(response, 413, { ok: false });
      return;
    }

    // A assinatura é sobre os bytes exatos recebidos: validar antes do parse.
    const signature = request.headers['x-hub-signature-256'];
    if (!service.isValidWebhookSignature(rawBody, Array.isArray(signature) ? signature[0] : signature)) {
      this.logger.error('Webhook da Meta com assinatura inválida');
      sendJson(response, 401, { ok: false });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      sendJson(response, 400, { ok: false });
      return;
    }

    // A Meta desiste e reenvia se não receber resposta rápido: confirma já e
    // processa em seguida. O unique em meta_leadgen_id absorve reenvios.
    sendJson(response, 200, { ok: true });
    void service.processWebhook(payload).catch((error: unknown) => {
      this.logger.error('Falha ao processar webhook da Meta', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

function parseAudience(value: unknown): LeadAdAudience {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Campo obrigatório ausente: audience');
  }

  const audience = value as JsonObject;
  const rawCity = audience.city as JsonObject | null | undefined;
  const city =
    rawCity && typeof rawCity === 'object'
      ? {
          key: requiredString(rawCity, 'key'),
          name: requiredString(rawCity, 'name'),
          radiusKm: requiredNumber(rawCity, 'radiusKm'),
        }
      : undefined;

  return {
    city,
    countries: city ? [] : ['BR'],
    ageMin: requiredNumber(audience, 'ageMin'),
    ageMax: requiredNumber(audience, 'ageMax'),
  };
}

function statusFromError(error: unknown, message: string): number {
  if (error instanceof MetaApiError) return 502;
  if (message.includes('Sem permissão') || message.includes(EMPRESA_SUSPENSA)) return 403;
  if (message.includes('não encontrad')) return 404;
  if (
    message.includes('inválid') ||
    message.includes('obrigatório') ||
    message.includes('não conectado') ||
    message.includes('JSON')
  ) {
    return 400;
  }
  return 500;
}

function requiredParam(url: URL, key: string): string {
  const value = url.searchParams.get(key)?.trim();
  if (!value) throw new Error(`Campo obrigatório ausente: ${key}`);
  return value;
}

function requiredString(body: JsonObject, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Campo obrigatório ausente: ${key}`);
  return value.trim();
}

function requiredNumber(body: JsonObject, key: string): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Campo obrigatório ausente ou inválido: ${key}`);
  }
  return value;
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  const raw = await readRaw(request);
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw.toString('utf-8'));
  } catch {
    throw new Error('JSON inválido');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON inválido: esperado um objeto');
  }

  return parsed as JsonObject;
}

function readRaw(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        request.destroy();
        reject(new Error('Payload excede o limite permitido'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}
