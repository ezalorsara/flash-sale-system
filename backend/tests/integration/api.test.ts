import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createMongoClient, type MongoContext } from '../../src/clients/mongo.js';
import { createRedisClient, STOCK_KEY, USERS_KEY } from '../../src/clients/redis.js';
import { env } from '../../src/env.js';
import { reconcileStockFromMongo } from '../../src/services/saleService.js';

let mongod: MongoMemoryServer;
let uri: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  uri = mongod.getUri();
});

afterAll(async () => {
  await mongod.stop();
});

async function seedConfig(overrides: { startAt: Date; endAt: Date; totalStock?: number }) {
  const seedMongo = await createMongoClient(uri);
  await seedMongo.saleConfigs.deleteMany({ productId: env.productId });
  await seedMongo.orders.deleteMany({ productId: env.productId });
  await seedMongo.saleConfigs.insertOne({
    productId: env.productId,
    productName: env.productName,
    totalStock: overrides.totalStock ?? env.totalStock,
    startAt: overrides.startAt,
    endAt: overrides.endAt,
  });
  await seedMongo.client.close();
}

async function startApp(): Promise<{ app: FastifyInstance; mongo: MongoContext }> {
  const mongo = await createMongoClient(uri);
  const redis = createRedisClient();
  // reconcileStockFromMongo only fills in a MISSING counter (it must never
  // clobber another live instance's counter -- see its doc comment), so
  // each independent test scenario clears the shared Redis keys first to
  // get a genuinely fresh reconciliation rather than a no-op against
  // whatever a previous describe block left behind.
  await redis.del(STOCK_KEY(env.productId), USERS_KEY(env.productId));
  const app = await buildApp({ mongo, redis, logger: false });
  return { app, mongo };
}

describe('active sale', () => {
  let app: FastifyInstance;
  let mongo: MongoContext;

  beforeAll(async () => {
    await seedConfig({
      startAt: new Date(Date.now() - 60_000),
      endAt: new Date(Date.now() + 60 * 60_000),
      totalStock: 3,
    });
    ({ app, mongo } = await startApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await mongo.orders.deleteMany({ productId: env.productId });
    await app.redis.del(STOCK_KEY(env.productId), USERS_KEY(env.productId));
    await reconcileStockFromMongo(mongo, app.redis, app.saleConfig);
  });

  it('GET /api/sale/status reports active with full stock', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sale/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'active', totalStock: 3, remaining: 3 });
  });

  it('POST /api/purchase succeeds for a new user and decrements remaining stock', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/purchase',
      payload: { userId: 'alice' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().outcome).toBe('purchased');

    const status = await app.inject({ method: 'GET', url: '/api/sale/status' });
    expect(status.json().remaining).toBe(2);
  });

  it('POST /api/purchase rejects a repeat purchase from the same user', async () => {
    await app.inject({ method: 'POST', url: '/api/purchase', payload: { userId: 'alice' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/purchase',
      payload: { userId: 'alice' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().outcome).toBe('duplicate');
  });

  it('POST /api/purchase returns 410 once stock is exhausted', async () => {
    await app.inject({ method: 'POST', url: '/api/purchase', payload: { userId: 'u1' } });
    await app.inject({ method: 'POST', url: '/api/purchase', payload: { userId: 'u2' } });
    await app.inject({ method: 'POST', url: '/api/purchase', payload: { userId: 'u3' } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/purchase',
      payload: { userId: 'u4' },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().outcome).toBe('sold_out');
  });

  it('POST /api/purchase rejects a missing userId with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/purchase', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/purchase/:userId reflects purchase state', async () => {
    await app.inject({ method: 'POST', url: '/api/purchase', payload: { userId: 'alice' } });

    const bought = await app.inject({ method: 'GET', url: '/api/purchase/alice' });
    expect(bought.json()).toMatchObject({ purchased: true });

    const notBought = await app.inject({ method: 'GET', url: '/api/purchase/bob' });
    expect(notBought.json()).toMatchObject({ purchased: false, purchasedAt: null });
  });

  it('never oversells across concurrent HTTP requests for more users than stock', async () => {
    const responses = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        app.inject({ method: 'POST', url: '/api/purchase', payload: { userId: `race-${i}` } }),
      ),
    );

    const purchased = responses.filter((r) => r.statusCode === 201);
    const soldOut = responses.filter((r) => r.statusCode === 410);

    expect(purchased).toHaveLength(3);
    expect(soldOut).toHaveLength(27);

    const status = await app.inject({ method: 'GET', url: '/api/sale/status' });
    expect(status.json().remaining).toBe(0);

    const orderCount = await mongo.orders.countDocuments({ productId: env.productId });
    expect(orderCount).toBe(3);
  });
});

describe('upcoming sale', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await seedConfig({
      startAt: new Date(Date.now() + 60 * 60_000),
      endAt: new Date(Date.now() + 2 * 60 * 60_000),
    });
    ({ app } = await startApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/sale/status reports upcoming', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sale/status' });
    expect(res.json().status).toBe('upcoming');
  });

  it('POST /api/purchase is rejected with 425 Too Early', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/purchase',
      payload: { userId: 'eager-alice' },
    });
    expect(res.statusCode).toBe(425);
    expect(res.json().outcome).toBe('not_started');
  });
});

describe('ended sale', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await seedConfig({
      startAt: new Date(Date.now() - 2 * 60 * 60_000),
      endAt: new Date(Date.now() - 60 * 60_000),
    });
    ({ app } = await startApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/sale/status reports ended', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sale/status' });
    expect(res.json().status).toBe('ended');
  });

  it('POST /api/purchase is rejected with 410 Gone', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/purchase',
      payload: { userId: 'late-bob' },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().outcome).toBe('ended');
  });
});

describe('boot-time reconciliation safety', () => {
  const productId = 'reconcile-race-test';
  const config = {
    productId,
    productName: 'Reconcile Test',
    totalStock: 10,
    startAt: new Date(Date.now() - 60_000),
    endAt: new Date(Date.now() + 60_000),
  };

  it('does not clobber a live counter when reconciled again while it already exists', async () => {
    const mongo = await createMongoClient(uri);
    const redis = createRedisClient();
    await redis.del(STOCK_KEY(productId), USERS_KEY(productId));
    await mongo.orders.deleteMany({ productId });
    await mongo.orders.insertMany([
      { userId: 'a', productId, createdAt: new Date() },
      { userId: 'b', productId, createdAt: new Date() },
    ]);

    // First instance boots: Redis has no counter yet, so it rebuilds from
    // Mongo's order count (2 orders -> 8 remaining).
    const first = await reconcileStockFromMongo(mongo, redis, config);
    expect(first).toBe(8);

    // 3 more units sell concurrently through another already-running
    // instance, decrementing the *live* Redis counter directly -- their
    // Mongo writes haven't necessarily been observed by anyone else yet.
    await redis.decrby(STOCK_KEY(productId), 3);
    expect(await redis.get(STOCK_KEY(productId))).toBe('5');

    // A second instance boots around the same time and reconciles using
    // the same stale Mongo snapshot (still sees 2 orders). Before the NX
    // guard, this would have overwritten the live "5" back up to "8" --
    // un-decrementing 3 units that were legitimately sold and reopening an
    // oversell window. It must instead leave the live value untouched.
    const second = await reconcileStockFromMongo(mongo, redis, config);
    expect(second).toBe(5);
    expect(await redis.get(STOCK_KEY(productId))).toBe('5');

    await redis.del(STOCK_KEY(productId), USERS_KEY(productId));
    await redis.quit();
    await mongo.client.close();
  });
});
