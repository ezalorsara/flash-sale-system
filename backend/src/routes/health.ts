import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    const [redisOk, mongoOk] = await Promise.all([
      app.redis.ping().then(() => true).catch(() => false),
      app.mongo.client.db().admin().ping().then(() => true).catch(() => false),
    ]);

    const ok = redisOk && mongoOk;
    return reply.code(ok ? 200 : 503).send({ ok, redis: redisOk, mongo: mongoOk });
  });
}
