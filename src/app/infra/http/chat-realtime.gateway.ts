import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { URL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { ChatConversationSummary, ChatMessageItem } from '../../domain/interfaces/chat-store.interface.js';
import { Logger } from '../../domain/interfaces/logger.interface.js';
import { NotificationItem } from '../../domain/interfaces/notification-store.interface.js';

type ChatSocketMessage =
  | {
      type: 'typing';
      conversationId: string;
      recipientUserId: string;
      isTyping: boolean;
    }
  | {
      type: 'ping';
    };

type OutboundEvent =
  | {
      type: 'chat_message';
      conversation: ChatConversationSummary;
      message: ChatMessageItem;
    }
  | {
      type: 'chat_typing';
      conversationId: string;
      userId: string;
      isTyping: boolean;
    }
  | {
      type: 'notification_created';
      notification: NotificationItem;
    };

export interface ChatRealtimeGatewayConfig {
  apiKey?: string;
}

export class ChatRealtimeGateway {
  private readonly webSocketServer = new WebSocketServer({ noServer: true });
  private readonly socketsByUserId = new Map<string, Set<WebSocket>>();

  constructor(
    private readonly config: ChatRealtimeGatewayConfig,
    private readonly logger: Logger,
  ) {
    this.webSocketServer.on('connection', (
      socket: WebSocket,
      request: http.IncomingMessage,
      userId: string,
    ) => {
      this.handleConnection(socket, request, userId.toString());
    });
  }

  attach(server: http.Server) {
    server.on('upgrade', (request, socket, head) => {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');

      if (requestUrl.pathname !== '/ws/chat') {
        socket.destroy();
        return;
      }

      const apiKey = requestUrl.searchParams.get('apiKey') ?? '';
      const userId = requestUrl.searchParams.get('userId')?.trim() ?? '';

      if (!this.isAuthorized(apiKey) || !userId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.webSocketServer.emit('connection', webSocket, request, userId);
      });
    });
  }

  emitChatMessage(userIds: string[], payload: {
    conversation: ChatConversationSummary;
    message: ChatMessageItem;
  }) {
    this.broadcast(userIds, {
      type: 'chat_message',
      conversation: payload.conversation,
      message: payload.message,
    });
  }

  emitNotification(userId: string, notification: NotificationItem) {
    this.broadcast([userId], {
      type: 'notification_created',
      notification,
    });
  }

  private handleConnection(socket: WebSocket, _request: http.IncomingMessage, userId: string) {
    const existingSockets = this.socketsByUserId.get(userId) ?? new Set<WebSocket>();
    existingSockets.add(socket);
    this.socketsByUserId.set(userId, existingSockets);

    socket.on('message', (rawMessage) => {
      try {
        const parsed = JSON.parse(rawMessage.toString('utf-8')) as ChatSocketMessage;

        if (
          parsed.type === 'typing' &&
          parsed.conversationId &&
          parsed.recipientUserId
        ) {
          this.broadcast([parsed.recipientUserId], {
            type: 'chat_typing',
            conversationId: parsed.conversationId,
            userId,
            isTyping: parsed.isTyping,
          });
        }
      } catch (error) {
        this.logger.error('Falha ao processar mensagem do websocket do chat', {
          error: error instanceof Error ? error.message : String(error),
          userId,
        });
      }
    });

    socket.on('close', () => {
      const userSockets = this.socketsByUserId.get(userId);

      if (!userSockets) {
        return;
      }

      userSockets.delete(socket);

      if (userSockets.size === 0) {
        this.socketsByUserId.delete(userId);
      }
    });
  }

  private broadcast(userIds: string[], event: OutboundEvent) {
    const payload = JSON.stringify(event);

    for (const userId of userIds) {
      const sockets = this.socketsByUserId.get(userId);

      if (!sockets || sockets.size === 0) {
        continue;
      }

      for (const socket of sockets) {
        if (socket.readyState !== WebSocket.OPEN) {
          continue;
        }

        socket.send(payload);
      }
    }
  }

  private isAuthorized(receivedApiKey: string) {
    if (!this.config.apiKey) {
      return false;
    }

    const configured = Buffer.from(this.config.apiKey);
    const received = Buffer.from(receivedApiKey);

    if (configured.length !== received.length) {
      return false;
    }

    return timingSafeEqual(configured, received);
  }
}
