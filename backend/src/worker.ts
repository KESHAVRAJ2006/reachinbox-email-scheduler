// Worker process entry point: `npm run dev:worker` (development) or `npm run worker`.
// It runs separately from the API, so sending never slows down HTTP requests,
// and you can run several workers side by side for more throughput.
import './config/env';
import { runMigrations } from './db/migrate';
import { pool } from './db/pool';
import { redis } from './lib/redis';
import { closeEmailQueue } from './queue/email-queue';
import { ensureEmailIndex } from './search/email-index';
import { startWorker } from './worker/start-worker';

async function main() {
  // The worker may boot before the API, so it makes sure the schema exists too.
  // The advisory lock in runMigrations stops the two from clashing.
  await runMigrations();
  await ensureEmailIndex().catch((err: Error) => console.warn('[search] index not ready:', err.message));

  const stopWorker = await startWorker();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] ${signal} received, finishing active jobs...`);
    setTimeout(() => process.exit(1), 30_000).unref();
    await stopWorker();
    await Promise.allSettled([closeEmailQueue(), redis.quit(), pool.end()]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[worker] failed to start:', err);
  process.exit(1);
});
