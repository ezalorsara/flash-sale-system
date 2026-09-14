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
 * records, but ONLY if Redis has no counter for this product yet (a fresh
 * Redis, or one that lost its AOF). Mongo is the durable source of truth for
 * that recovery case.
 *
 * This must NOT run unconditionally on every process boot: with several API
 * instances behind a load balancer, a newly-booting instance would otherwise
 * snapshot Mongo's order count and overwrite Redis's live stock counter with
 * a stale (higher) number *after* other already-running instances sold more
 * units concurrently -- silently un-decrementing stock and reopening an
 * oversell window. Guarding on "SET ... NX" makes the rebuild a no-op
 * whenever Redis already holds a value, so a routine restart of one instance
 * can never clobber the others' in-flight state.
 */
export async function reconcileStockFromMongo(
  mongo: MongoContext,
  redis: RedisClient,
  config: SaleConfig,
): Promise<number> {
  const stockKey = STOCK_KEY(config.productId);
  const usersKey = USERS_KEY(config.productId);

  const purchasedUserIds = await mongo.orders
    .find({ productId: config.productId })
    .map((order) => order.userId)
    .toArray();
  const remaining = Math.max(config.totalStock - purchasedUserIds.length, 0);

  const claimed = await redis.set(stockKey, remaining, 'NX');
  if (claimed !== 'OK') {
    // Another instance already initialized (or is actively serving) this
    // product's counters -- trust the live value instead of overwriting it.
    const current = await redis.get(stockKey);
    return current === null ? remaining : Math.max(Number(current), 0);
  }

  if (purchasedUserIds.length > 0) {
    await redis.sadd(usersKey, ...purchasedUserIds);
  }

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
