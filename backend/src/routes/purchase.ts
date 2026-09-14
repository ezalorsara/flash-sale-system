import type { FastifyInstance } from 'fastify';
import { attemptPurchase, checkPurchase } from '../services/purchaseService.js';
import type { PurchaseOutcome } from '../types.js';

export function httpStatusForOutcome(outcome: PurchaseOutcome): number {
  switch (outcome) {
    case 'purchased':
      return 201;
    case 'duplicate':
      return 409;
    case 'sold_out':
      return 410;
    case 'ended':
      return 410;
    case 'not_started':
      return 425; // Too Early (RFC 8470)
    case 'error':
      return 503;
  }
}

interface PurchaseBody {
  userId?: unknown;
}

function extractUserId(body: PurchaseBody): string | null {
  if (typeof body.userId !== 'string') return null;
  const trimmed = body.userId.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

export async function purchaseRoutes(app: FastifyInstance) {
  app.post<{ Body: PurchaseBody }>('/api/purchase', async (request, reply) => {
    const userId = extractUserId(request.body ?? {});
    if (!userId) {
      return reply.code(400).send({ outcome: 'invalid_request', message: 'userId is required.' });
    }

    const config = app.saleConfig;
    const result = await attemptPurchase(app.mongo, app.redis, config, userId);
    return reply.code(httpStatusForOutcome(result.outcome)).send(result);
  });

  app.get<{ Params: { userId: string } }>('/api/purchase/:userId', async (request, reply) => {
    const userId = request.params.userId?.trim();
    if (!userId) {
      return reply.code(400).send({ message: 'userId is required.' });
    }

    const result = await checkPurchase(app.mongo, app.saleConfig, userId);
    return reply.send(result);
  });
}
