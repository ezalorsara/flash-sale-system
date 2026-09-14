import 'dotenv/config';

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017',
  mongoDb: process.env.MONGO_DB ?? 'flashsale',
  productId: process.env.PRODUCT_ID ?? 'flash-item-1',
  productName: process.env.PRODUCT_NAME ?? 'Limited Edition Sneaker',
  totalStock: Number(process.env.SALE_TOTAL_STOCK ?? 50),
  startAt: process.env.SALE_START_AT ? new Date(process.env.SALE_START_AT) : new Date(),
  endAt: process.env.SALE_END_AT ? new Date(process.env.SALE_END_AT) : minutesFromNow(10),
};
