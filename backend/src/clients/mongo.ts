import { MongoClient, type Collection } from 'mongodb';
import { env } from '../env.js';
import type { Order, SaleConfig } from '../types.js';

export async function createMongoClient(url: string = env.mongoUrl) {
  const client = new MongoClient(url);
  await client.connect();
  const db = client.db(env.mongoDb);

  const orders: Collection<Order> = db.collection('orders');
  const saleConfigs: Collection<SaleConfig> = db.collection('saleConfig');

  await orders.createIndex({ userId: 1, productId: 1 }, { unique: true });
  await orders.createIndex({ productId: 1 });

  return { client, db, orders, saleConfigs };
}

export type MongoContext = Awaited<ReturnType<typeof createMongoClient>>;
