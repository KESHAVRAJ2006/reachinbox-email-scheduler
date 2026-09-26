import { Router } from 'express';
import { pool } from '../db/pool';
import { redis } from '../lib/redis';
import { elastic } from '../lib/elastic';

// A dependency that doesn't answer in this time counts as down. Without a timeout,
// a hung Redis would make the health check itself hang.
const CHECK_TIMEOUT_MS = 3_000;

type CheckResult = { ok: boolean; latencyMs: number; error?: string };

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no response within ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function check(probe: () => Promise<unknown>): Promise<CheckResult> {
  const startedAt = Date.now();
  try {
    await withTimeout(probe(), CHECK_TIMEOUT_MS);
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - startedAt, error: (err as Error).message };
  }
}

export const healthRouter = Router();

// GET /api/health: 200 if every dependency answers, 503 if any is down.
// 503 lets a load balancer or uptime monitor tell "broken" from "fine".
healthRouter.get('/', async (_req, res) => {
  // The three probes run in parallel, so the total time is the slowest one, not the sum.
  const [postgres, redisResult, elasticsearch] = await Promise.all([
    check(() => pool.query('SELECT 1')),
    check(() => redis.ping()),
    check(() => elastic.ping()),
  ]);

  const checks = { postgres, redis: redisResult, elasticsearch };
  const healthy = Object.values(checks).every((result) => result.ok);

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    checks,
  });
});
