import { buildApp } from './server.js';

async function bootstrap(): Promise<void> {
  const app = buildApp();
  await app.start();
}

bootstrap().catch((error) => {
  console.error('[ERROR] Falha ao inicializar aplicação', error);
  process.exit(1);
});
