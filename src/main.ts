import { buildApp } from './server.js';

process.on('unhandledRejection', (reason) => {
  if (isIgnorableBaileysTimeout(reason)) {
    console.warn('[WARN] Timeout interno do Baileys ignorado; o bot seguirá tentando reconectar.', reason);
    return;
  }

  console.error('[ERROR] Unhandled promise rejection', reason);
});

process.on('uncaughtException', (error) => {
  if (isIgnorableBaileysTimeout(error)) {
    console.warn('[WARN] Exceção de timeout do Baileys ignorada; o bot seguirá tentando reconectar.', error);
    return;
  }

  console.error('[ERROR] Exceção não tratada', error);
  process.exit(1);
});

async function bootstrap(): Promise<void> {
  const app = buildApp();
  await app.start();
}

bootstrap().catch((error) => {
  console.error('[ERROR] Falha ao inicializar aplicação', error);
  process.exit(1);
});

function isIgnorableBaileysTimeout(error: unknown): boolean {
  if (!(error instanceof Error) || error.message !== 'Timed Out') {
    return false;
  }

  const stack = error.stack ?? '';
  const nestedStack =
    typeof (error as { data?: { stack?: unknown } }).data?.stack === 'string'
      ? (error as { data?: { stack?: string } }).data?.stack ?? ''
      : '';

  return `${stack}\n${nestedStack}`.includes('@whiskeysockets/baileys');
}
