/**
 * Stress test for the flash sale purchase flow.
 *
 * Fires far more concurrent purchase attempts than there is stock against a
 * *running* server (start it separately with `npm run dev` or the built
 * production server) and proves two things that matter more than raw
 * throughput here:
 *
 *   1. Exactly `totalStock` requests succeed -- never more (no overselling).
 *   2. A single user racing itself concurrently only ever wins once.
 *
 * It then cross-checks the result against MongoDB directly, independently
 * of the Redis-backed counter the API itself reports, so a bug that made
 * the two stores disagree would still be caught.
 *
 * Usage: npm run stress
 * Env:   STRESS_TARGET (default http://127.0.0.1:4000)
 *        STRESS_CONCURRENCY (default 3000)   -- unique-user oversell attempt
 *        STRESS_DUP_CONCURRENCY (default 300) -- same-user race attempt
 */
import { MongoClient } from 'mongodb';
import { env } from '../src/env.js';

const TARGET = process.env.STRESS_TARGET ?? 'http://127.0.0.1:4000';
const UNIQUE_CONCURRENCY = Number(process.env.STRESS_CONCURRENCY ?? 3000);
const DUP_CONCURRENCY = Number(process.env.STRESS_DUP_CONCURRENCY ?? 300);

interface AttemptResult {
  status: number;
  outcome: string;
  latencyMs: number;
}

async function purchase(userId: string): Promise<AttemptResult> {
  const start = performance.now();
  try {
    const res = await fetch(`${TARGET}/api/purchase`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const body = (await res.json()) as { outcome?: string };
    return { status: res.status, outcome: body.outcome ?? 'unknown', latencyMs: performance.now() - start };
  } catch {
    return { status: 0, outcome: 'network_error', latencyMs: performance.now() - start };
  }
}

function summarizeLatency(results: AttemptResult[]) {
  const sorted = [...results].map((r) => r.latencyMs).sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    min: sorted[0],
    mean,
    p50: pct(50),
    p95: pct(95),
    p99: pct(99),
    max: sorted[sorted.length - 1],
  };
}

function tally(results: AttemptResult[]) {
  const counts = new Map<string, number>();
  for (const r of results) {
    counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
  }
  return counts;
}

function fmt(n: number) {
  return n.toFixed(1).padStart(7);
}

async function main() {
  console.log(`\nFlash sale stress test — target ${TARGET}\n${'='.repeat(60)}`);

  const statusRes = await fetch(`${TARGET}/api/sale/status`);
  if (!statusRes.ok) {
    throw new Error(`Server not reachable at ${TARGET} (GET /api/sale/status -> ${statusRes.status})`);
  }
  const before = await statusRes.json();
  console.log(`Sale before: status=${before.status} remaining=${before.remaining}/${before.totalStock}\n`);

  // --- Phase 1: same-user concurrent race (run first, while stock is fresh,
  // so this phase actually contests real stock instead of hitting sold-out) --
  const raceUserId = `stress-race-${Date.now()}`;
  console.log(`Phase 1: ${DUP_CONCURRENCY} concurrent requests from the SAME user ("${raceUserId}")...`);
  const dupResults = await Promise.all(
    Array.from({ length: DUP_CONCURRENCY }, () => purchase(raceUserId)),
  );
  const dupCounts = tally(dupResults);
  console.log('  outcomes:', Object.fromEntries(dupCounts));

  // --- Phase 2: unique-user oversell attempt against whatever stock remains -
  const midStatus = await (await fetch(`${TARGET}/api/sale/status`)).json();
  console.log(`\nPhase 2: ${UNIQUE_CONCURRENCY} concurrent unique users vs ${midStatus.remaining} remaining stock...`);
  const uniqueIds = Array.from({ length: UNIQUE_CONCURRENCY }, (_, i) => `stress-${Date.now()}-${i}`);
  const t0 = performance.now();
  const uniqueResults = await Promise.all(uniqueIds.map(purchase));
  const wallMs = performance.now() - t0;

  const uniqueCounts = tally(uniqueResults);
  const uniqueLatency = summarizeLatency(uniqueResults);
  const purchased = uniqueCounts.get('purchased') ?? 0;

  console.log(`  wall time:       ${(wallMs / 1000).toFixed(2)}s (${(UNIQUE_CONCURRENCY / (wallMs / 1000)).toFixed(0)} req/s)`);
  console.log(`  latency ms:      min ${fmt(uniqueLatency.min)}  mean ${fmt(uniqueLatency.mean)}  p50 ${fmt(uniqueLatency.p50)}  p95 ${fmt(uniqueLatency.p95)}  p99 ${fmt(uniqueLatency.p99)}  max ${fmt(uniqueLatency.max)}`);
  console.log('  outcomes:', Object.fromEntries(uniqueCounts));

  // --- Cross-check against MongoDB directly ---------------------------------
  const client = new MongoClient(env.mongoUrl);
  await client.connect();
  const orderCount = await client
    .db(env.mongoDb)
    .collection('orders')
    .countDocuments({ productId: before.productId });
  await client.close();

  const afterRes = await fetch(`${TARGET}/api/sale/status`);
  const after = await afterRes.json();

  console.log(`\nSale after:  status=${after.status} remaining=${after.remaining}/${after.totalStock}`);
  console.log(`Mongo order count for "${before.productId}": ${orderCount}\n`);

  // --- Assertions -------------------------------------------------------------
  const expectedSold = before.totalStock - after.remaining;
  const checks: Array<[string, boolean]> = [
    [`same user won exactly once under ${DUP_CONCURRENCY}x concurrent self-race`, (dupCounts.get('purchased') ?? 0) === 1],
    [`the other ${DUP_CONCURRENCY - 1} concurrent requests from that user were all rejected as duplicates`, (dupCounts.get('duplicate') ?? 0) === DUP_CONCURRENCY - 1],
    [`exactly the remaining stock (${midStatus.remaining}) was sold in phase 2, not more`, purchased === midStatus.remaining],
    [`no oversell: Redis remaining (${after.remaining}) + total sold (${expectedSold}) == totalStock`, after.remaining + expectedSold === after.totalStock],
    [`Mongo order count (${orderCount}) matches units sold (${expectedSold})`, orderCount === expectedSold],
    ['no request crashed the server (0 network errors)', (uniqueCounts.get('network_error') ?? 0) === 0 && (dupCounts.get('network_error') ?? 0) === 0],
  ];

  console.log('Assertions:');
  let allPassed = true;
  for (const [label, passed] of checks) {
    console.log(`  ${passed ? '✓' : '✗'} ${label}`);
    if (!passed) allPassed = false;
  }
  console.log(`\n${'='.repeat(60)}\n${allPassed ? 'PASS' : 'FAIL'} — see README for how to interpret these results.\n`);

  process.exitCode = allPassed ? 0 : 1;
}

main().catch((err) => {
  console.error('Stress test crashed:', err);
  process.exitCode = 1;
});
