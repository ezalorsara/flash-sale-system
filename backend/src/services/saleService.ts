import { env } from '../env.js';
import type { MongoContext } from '../clients/mongo.js';
import { STOCK_KEY, USERS_KEY, type RedisClient } from '../clients/redis.js';
import type { SaleConfig, SaleStatus, SaleStatusResponse } from '../types.js';

/**
 * Persists the sale configuration once (first boot wins) so the sale window
 * survives restarts and stays identical across every API instance sharing
 * this Mongo database, instead of resetting on every deploy.
 */
export async function ensureSaleConfig(mongo: MongoContext): Promise<SaleConfig> {
  const defaults: SaleConfig = {
    productId: env.productId,
    productName: env.productName,
    totalStock: env.totalStock,
    startAt: env.startAt,
    endAt: env.endAt,
  };

  await mongo.saleConfigs.updateOne(
    { productId: env.productId },
    { $setOnInsert: defaults },
    { upsert: true },
  );

  const stored = await mongo.saleConfigs.findOne({ productId: env.productId });
  return stored ?? defaults;
}

/**
 * Rebuilds Redis's stock counter and purchased-user set from Mongo's order
 * records. Mongo is the durable source of truth, so this makes a restarted
 * (or freshly started) Redis instance self-heal to the correct state instead
 * of re-granting stock that was already sold.
 */
export async function reconcileStockFromMongo(
  mongo: MongoContext,
  redis: RedisClient,
  config: SaleConfig,
): Promise<number> {
  const purchasedUserIds = await mongo.orders
    .find({ productId: config.productId })
    .map((order) => order.userId)
    .toArray();

  const remaining = Math.max(config.totalStock - purchasedUserIds.length, 0);
  const stockKey = STOCK_KEY(config.productId);
  const usersKey = USERS_KEY(config.productId);

  const pipeline = redis.pipeline();
  pipeline.set(stockKey, remaining);
  pipeline.del(usersKey);
  if (purchasedUserIds.length > 0) {
    pipeline.sadd(usersKey, ...purchasedUserIds);
  }
  await pipeline.exec();

  return remaining;
}

export function deriveSaleStatus(config: SaleConfig, now: Date): SaleStatus {
  if (now < config.startAt) return 'upcoming';
  if (now > config.endAt) return 'ended';
  return 'active';
}

export async function getSaleStatusResponse(
  mongo: MongoContext,
  redis: RedisClient,
  config: SaleConfig,
): Promise<SaleStatusResponse> {
  const now = new Date();
  const remainingRaw = await redis.get(STOCK_KEY(config.productId));
  const remaining = remainingRaw === null ? 0 : Math.max(Number(remainingRaw), 0);

  return {
    productId: config.productId,
    productName: config.productName,
    status: deriveSaleStatus(config, now),
    startAt: config.startAt.toISOString(),
    endAt: config.endAt.toISOString(),
    totalStock: config.totalStock,
    remaining,
    serverTime: now.toISOString(),
  };
}
