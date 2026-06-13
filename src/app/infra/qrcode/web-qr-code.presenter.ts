import { createReadStream, existsSync } from 'node:fs';
import http, { Server, ServerResponse } from 'node:http';
import path from 'node:path';
import QRCode from 'qrcode';
import {
  DashboardDocument,
  DashboardPresenter,
  WhatsAppConnectionStatus,
} from '../../domain/interfaces/dashboard.interface.js';
import { Logger } from '../../domain/interfaces/logger.interface.js';
import { QrCodePresenter } from '../../domain/interfaces/qr-code-presenter.interface.js';

interface WebQrCodePresenterConfig {
  port: number;
  frontendDir: string;
  loadDocuments?: () => Promise<DashboardDocument[]>;
}

interface QrCodePayload {
  dataUrl: string;
  updatedAt: string;
}

interface DashboardState {
  connectionStatus: WhatsAppConnectionStatus;
  qrCode: QrCodePayload | null;
  documents: DashboardDocument[];
}

export class WebQrCodePresenter implements QrCodePresenter, DashboardPresenter {
  private server?: Server;
  private latestQrCode?: QrCodePayload;
  private connectionStatus: WhatsAppConnectionStatus = 'disconnected';
  private readonly documents: DashboardDocument[] = [];
  private readonly clients = new Set<ServerResponse>();

  constructor(
    private readonly config: WebQrCodePresenterConfig,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.server) {
      return;
    }

    this.server = http.createServer((request, response) => {
      const url = new URL(request.url ?? '/', `http://localhost:${this.config.port}`);

      if (url.pathname === '/qr') {
        this.handleQrRequest(response);
        return;
      }

      if (url.pathname === '/state') {
        void this.handleStateRequest(response);
        return;
      }

      if (url.pathname === '/documents') {
        void this.handleDocumentsRequest(response);
        return;
      }

      if (url.pathname === '/events') {
        this.handleEventsRequest(response);
        return;
      }

      this.serveFrontendFile(url.pathname, response);
    });

    this.server.listen(this.config.port, () => {
      this.logger.info('QR Code web frontend disponível', {
        url: `http://localhost:${this.config.port}`,
      });
    });
  }

  show(qrCode: string): void {
    void QRCode.toDataURL(qrCode, {
      margin: 2,
      width: 320,
    }).then((dataUrl) => {
      this.latestQrCode = {
        dataUrl,
        updatedAt: new Date().toISOString(),
      };

      this.broadcast('qr', this.latestQrCode);
    });
  }

  clear(): void {
    this.latestQrCode = undefined;
    this.broadcast('qr', null);
  }

  updateConnectionStatus(status: WhatsAppConnectionStatus): void {
    this.connectionStatus = status;
    this.broadcast('connection', {
      status,
      updatedAt: new Date().toISOString(),
    });
  }

  addDocument(document: DashboardDocument): void {
    this.documents.unshift(document);
    this.broadcast('document', document);
  }

  private handleQrRequest(response: ServerResponse): void {
    this.sendJson(response, {
      qrCode: this.latestQrCode ?? null,
    });
  }

  private async handleStateRequest(response: ServerResponse): Promise<void> {
    this.sendJson(response, await this.getState());
  }

  async getStateSnapshot(): Promise<DashboardState> {
    return this.getState();
  }

  private async handleDocumentsRequest(response: ServerResponse): Promise<void> {
    this.sendJson(response, {
      documents: await this.getDocuments(),
    });
  }

  private handleEventsRequest(response: ServerResponse): void {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    this.clients.add(response);

    if (this.latestQrCode) {
      this.sendEvent(response, 'qr', this.latestQrCode);
    }

    this.sendEvent(response, 'connection', {
      status: this.connectionStatus,
      updatedAt: new Date().toISOString(),
    });

    response.on('close', () => {
      this.clients.delete(response);
    });
  }

  private serveFrontendFile(requestPath: string, response: ServerResponse): void {
    const filePath =
      requestPath === '/'
        ? path.join(this.config.frontendDir, 'index.html')
        : path.join(this.config.frontendDir, requestPath);

    if (!filePath.startsWith(this.config.frontendDir) || !existsSync(filePath)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': this.getContentType(filePath),
    });
    createReadStream(filePath).pipe(response);
  }

  private async getState(): Promise<DashboardState> {
    return {
      connectionStatus: this.connectionStatus,
      qrCode: this.latestQrCode ?? null,
      documents: await this.getDocuments(),
    };
  }

  private async getDocuments(): Promise<DashboardDocument[]> {
    let storedDocuments: DashboardDocument[] = [];

    try {
      storedDocuments = (await this.config.loadDocuments?.()) ?? [];
    } catch (error) {
      this.logger.error('Falha ao buscar documentos no storage', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const documentsById = new Map<string, DashboardDocument>();

    storedDocuments.forEach((document) => documentsById.set(document.id, document));
    this.documents.forEach((document) => documentsById.set(document.id, document));

    return [...documentsById.values()].sort(
      (left, right) =>
        new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime(),
    );
  }

  private broadcast(event: string, payload: unknown): void {
    this.clients.forEach((client) => this.sendEvent(client, event, payload));
  }

  private sendEvent(
    response: ServerResponse,
    event: string,
    payload: unknown,
  ): void {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  private sendJson(response: ServerResponse, data: unknown): void {
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify(data));
  }

  private getContentType(filePath: string): string {
    if (filePath.endsWith('.css')) {
      return 'text/css; charset=utf-8';
    }

    if (filePath.endsWith('.js')) {
      return 'application/javascript; charset=utf-8';
    }

    return 'text/html; charset=utf-8';
  }
}
