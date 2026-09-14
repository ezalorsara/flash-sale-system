import type { FastifyInstance } from 'fastify';
import { getSaleStatusResponse } from '../services/saleService.js';

export async function saleRoutes(app: FastifyInstance) {
  app.get('/api/sale/status', async (_request, reply) => {
    const response = await getSaleStatusResponse(app.mongo, app.redis, app.saleConfig);
    return reply.send(response);
  });
}
