/**
 * Dev/demo utility: wipes all orders and re-seeds Redis so the sale can be
 * run again from a clean slate without restarting the server.
 */
import { createMongoClient } from '../src/clients/mongo.js';
import { createRedisClient, STOCK_KEY, USERS_KEY } from '../src/clients/redis.js';
import { ensureSaleConfig, reconcileStockFromMongo } from '../src/services/saleService.js';

const mongo = await createMongoClient();
const redis = createRedisClient();

const config = await ensureSaleConfig(mongo);
await mongo.orders.deleteMany({ productId: config.productId });
// reconcileStockFromMongo only fills in a MISSING counter (see its doc
// comment) so a deliberate reset needs to clear it first, unlike a normal
// boot which must never clobber another live instance's counter.
await redis.del(STOCK_KEY(config.productId), USERS_KEY(config.productId));
const remaining = await reconcileStockFromMongo(mongo, redis, config);

console.log(`sale reset: ${config.productId} now has ${remaining}/${config.totalStock} in stock`);

await redis.quit();
await mongo.client.close();
