import { Logger } from '../../domain/interfaces/logger.interface.js';

export class ConsoleLogger implements Logger {
  info(message: string, context?: Record<string, unknown>): void {
    this.write('INFO', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.write('WARN', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.write('ERROR', message, context);
  }

  private write(
    level: 'INFO' | 'WARN' | 'ERROR',
    message: string,
    context?: Record<string, unknown>,
  ): void {
    const suffix = context ? ` ${JSON.stringify(context)}` : '';
    console.log(`[${level}] ${message}${suffix}`);
  }
}
