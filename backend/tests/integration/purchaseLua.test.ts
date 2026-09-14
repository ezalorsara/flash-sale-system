import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createRedisClient, STOCK_KEY, USERS_KEY } from '../../src/clients/redis.js';

const productId = 'lua-test';
const stockKey = STOCK_KEY(productId);
const usersKey = USERS_KEY(productId);
const redis = createRedisClient();

async function seed(stock: number) {
  await redis.del(stockKey, usersKey);
  await redis.set(stockKey, stock);
}

afterAll(async () => {
  await redis.del(stockKey, usersKey);
  await redis.quit();
});

describe('purchase.lua atomic gate', () => {
  beforeEach(async () => {
    await seed(2);
  });

  it('returns -2 when the stock counter was never initialized', async () => {
    await redis.del(stockKey, usersKey);
    const result = await redis.purchaseAttempt(stockKey, usersKey, 'anyone');
    expect(result).toBe(-2);
  });

  it('reserves stock and decrements the counter', async () => {
    const result = await redis.purchaseAttempt(stockKey, usersKey, 'alice');
    expect(result).toBe(1);
    expect(await redis.get(stockKey)).toBe('1');
    expect(await redis.sismember(usersKey, 'alice')).toBe(1);
  });

  it('rejects a second attempt by the same user as a duplicate, without touching stock', async () => {
    await redis.purchaseAttempt(stockKey, usersKey, 'alice');
    const second = await redis.purchaseAttempt(stockKey, usersKey, 'alice');
    expect(second).toBe(-1);
    expect(await redis.get(stockKey)).toBe('1'); // unchanged by the rejected attempt
  });

  it('returns 0 (sold out) once stock is exhausted, even for a brand-new user', async () => {
    await redis.purchaseAttempt(stockKey, usersKey, 'alice');
    await redis.purchaseAttempt(stockKey, usersKey, 'bob');
    const third = await redis.purchaseAttempt(stockKey, usersKey, 'carol');
    expect(third).toBe(0);
    expect(await redis.get(stockKey)).toBe('0');
  });

  it('compensate.lua rolls back a reservation atomically', async () => {
    await redis.purchaseAttempt(stockKey, usersKey, 'alice');
    await redis.compensatePurchase(stockKey, usersKey, 'alice');
    expect(await redis.get(stockKey)).toBe('2');
    expect(await redis.sismember(usersKey, 'alice')).toBe(0);
  });

  it('never oversells under concurrent unique-user attempts (the core race condition)', async () => {
    await seed(20);
    const attempts = Array.from({ length: 500 }, (_, i) =>
      redis.purchaseAttempt(stockKey, usersKey, `user-${i}`),
    );
    const results = await Promise.all(attempts);

    const reserved = results.filter((r) => r === 1).length;
    const soldOut = results.filter((r) => r === 0).length;

    expect(reserved).toBe(20);
    expect(soldOut).toBe(480);
    expect(await redis.get(stockKey)).toBe('0');
    expect(await redis.scard(usersKey)).toBe(20);
  });

  it('never lets the same user win twice under concurrent duplicate attempts', async () => {
    await seed(20);
    const attempts = Array.from({ length: 50 }, () =>
      redis.purchaseAttempt(stockKey, usersKey, 'same-user'),
    );
    const results = await Promise.all(attempts);

    expect(results.filter((r) => r === 1).length).toBe(1);
    expect(results.filter((r) => r === -1).length).toBe(49);
    expect(await redis.get(stockKey)).toBe('19');
  });
});
