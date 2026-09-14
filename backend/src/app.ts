import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { createMongoClient, type MongoContext } from './clients/mongo.js';
import { createRedisClient, type RedisClient } from './clients/redis.js';
import { ensureSaleConfig, reconcileStockFromMongo } from './services/saleService.js';
import { healthRoutes } from './routes/health.js';
import { saleRoutes } from './routes/sale.js';
import { purchaseRoutes } from './routes/purchase.js';
import type { SaleConfig } from './types.js';

declare module 'fastify' {
  interface FastifyInstance {
    mongo: MongoContext;
    redis: RedisClient;
    saleConfig: SaleConfig;
  }
}

export interface BuildAppOptions {
  mongo?: MongoContext;
  redis?: RedisClient;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true });

  const mongo = options.mongo ?? (await createMongoClient());
  const redis = options.redis ?? createRedisClient();

  const config = await ensureSaleConfig(mongo);
  const remaining = await reconcileStockFromMongo(mongo, redis, config);
  app.log.info(
    { productId: config.productId, totalStock: config.totalStock, remaining },
    'sale config loaded and Redis reconciled from Mongo',
  );

  app.decorate('mongo', mongo);
  app.decorate('redis', redis);
  app.decorate('saleConfig', config);

  await app.register(cors, { origin: true });
  await app.register(healthRoutes);
  await app.register(saleRoutes);
  await app.register(purchaseRoutes);

  app.addHook('onClose', async () => {
    await redis.quit();
    await mongo.client.close();
  });

  return app;
}
