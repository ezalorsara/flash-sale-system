/**
 * Local-only convenience for environments without Docker/mongod installed:
 * boots a real mongod (via mongodb-memory-server, which downloads the actual
 * MongoDB binary) on the standard port so the app's default MONGO_URL just
 * works. Not part of the production path -- see docker-compose.yml for that.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const port = Number(process.env.MONGO_LOCAL_PORT ?? 27017);
const dbPath = process.env.MONGO_LOCAL_DBPATH;

const mongod = await MongoMemoryServer.create({
  instance: {
    port,
    ...(dbPath ? { dbPath, storageEngine: 'wiredTiger' } : {}),
  },
});

console.log(`local mongod ready at ${mongod.getUri()}`);

async function shutdown() {
  await mongod.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
