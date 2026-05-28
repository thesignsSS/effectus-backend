import { IncomingMessage } from '../domain/interfaces/messaging.interface.js';

type QueueHandler = (message: IncomingMessage) => Promise<void>;

export class DocumentProcessingQueueService {
  private readonly queue: IncomingMessage[] = [];
  private readonly idleResolvers: Array<() => void> = [];
  private activeCount = 0;

  constructor(
    private readonly concurrency: number,
    private readonly handler: QueueHandler,
  ) {}

  enqueue(message: IncomingMessage): void {
    this.queue.push(message);
    this.processNext();
  }

  size(): number {
    return this.queue.length;
  }

  active(): number {
    return this.activeCount;
  }

  waitForIdle(): Promise<void> {
    if (this.isIdle()) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private processNext(): void {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const message = this.queue.shift();

      if (!message) {
        return;
      }

      this.activeCount += 1;

      void this.handler(message).finally(() => {
        this.activeCount -= 1;
        this.processNext();
        this.resolveIdleIfNeeded();
      });
    }
  }

  private isIdle(): boolean {
    return this.queue.length === 0 && this.activeCount === 0;
  }

  private resolveIdleIfNeeded(): void {
    if (!this.isIdle()) {
      return;
    }

    while (this.idleResolvers.length > 0) {
      this.idleResolvers.shift()?.();
    }
  }
}
