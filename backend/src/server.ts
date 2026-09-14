import { buildApp } from './app.js';
import { env } from './env.js';

const app = await buildApp();

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: env.port, host: '0.0.0.0' });
