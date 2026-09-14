import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Redis, type Result } from 'ioredis';
import { env } from '../env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

declare module 'ioredis' {
  interface RedisCommander<Context> {
    purchaseAttempt(
      stockKey: string,
      usersKey: string,
      userId: string,
    ): Result<number, Context>;
    compensatePurchase(
      stockKey: string,
      usersKey: string,
      userId: string,
    ): Result<number, Context>;
  }
}

export const STOCK_KEY = (productId: string) => `sale:${productId}:stock`;
export const USERS_KEY = (productId: string) => `sale:${productId}:purchased-users`;

export function createRedisClient() {
  const client = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });

  client.defineCommand('purchaseAttempt', {
    numberOfKeys: 2,
    lua: readFileSync(join(__dirname, '../lua/purchase.lua'), 'utf8'),
  });

  client.defineCommand('compensatePurchase', {
    numberOfKeys: 2,
    lua: readFileSync(join(__dirname, '../lua/compensate.lua'), 'utf8'),
  });

  return client;
}

export type RedisClient = ReturnType<typeof createRedisClient>;
