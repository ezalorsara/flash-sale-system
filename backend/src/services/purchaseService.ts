import { MongoServerError } from 'mongodb';
import type { MongoContext } from '../clients/mongo.js';
import { STOCK_KEY, USERS_KEY, type RedisClient } from '../clients/redis.js';
import { deriveSaleStatus } from './saleService.js';
import type { PurchaseResult, SaleConfig } from '../types.js';

const MONGO_DUPLICATE_KEY_CODE = 11000;

function isDuplicateKeyError(err: unknown): boolean {
  return err instanceof MongoServerError && err.code === MONGO_DUPLICATE_KEY_CODE;
}

export async function attemptPurchase(
  mongo: MongoContext,
  redis: RedisClient,
  config: SaleConfig,
  userId: string,
): Promise<PurchaseResult> {
  const now = new Date();
  const phase = deriveSaleStatus(config, now);

  if (phase === 'upcoming') {
    return { outcome: 'not_started', message: 'The sale has not started yet.' };
  }
  if (phase === 'ended') {
    return { outcome: 'ended', message: 'The sale has ended.' };
  }

  const stockKey = STOCK_KEY(config.productId);
  const usersKey = USERS_KEY(config.productId);

  const result = await redis.purchaseAttempt(stockKey, usersKey, userId);

  if (result === -2) {
    return { outcome: 'error', message: 'Sale is not initialized yet. Please retry shortly.' };
  }
  if (result === -1) {
    return { outcome: 'duplicate', message: 'You already purchased this item.' };
  }
  if (result === 0) {
    return { outcome: 'sold_out', message: 'This item is sold out.' };
  }

  // result === 1: Redis granted a reservation. Persist it durably in Mongo;
  // if that fails for any reason, roll the reservation back so Redis and
  // Mongo never disagree about how many units are actually gone.
  try {
    await mongo.orders.insertOne({ userId, productId: config.productId, createdAt: now });
    return { outcome: 'purchased', message: 'Purchase successful! Your item is reserved.' };
  } catch (err) {
    await redis.compensatePurchase(stockKey, usersKey, userId);

    if (isDuplicateKeyError(err)) {
      // Only possible if Mongo already had this user's order while Redis's
      // copy of that fact was lost (e.g. Redis restarted without persistence
      // between requests) -- Mongo is the source of truth, so honor it.
      return { outcome: 'duplicate', message: 'You already purchased this item.' };
    }

    return { outcome: 'error', message: 'Could not complete the purchase. Please retry.' };
  }
}

export async function checkPurchase(mongo: MongoContext, config: SaleConfig, userId: string) {
  const order = await mongo.orders.findOne({ userId, productId: config.productId });
  return {
    userId,
    productId: config.productId,
    purchased: order !== null,
    purchasedAt: order?.createdAt.toISOString() ?? null,
  };
}
