// Worker process entry point: `npm run dev:worker` (development) or `npm run worker`.
// It runs separately from the API, so sending never slows down HTTP requests,
// and you can run several workers side by side for more throughput.
import { Worker } from 'bullmq';
import { env } from './config/env';
import { runMigrations } from './db/migrate';
import { pool } from './db/pool';
import { createRedisConnection, redis } from './lib/redis';
import { closeEmailQueue, EMAIL_QUEUE, type SendEmailJob } from './queue/email-queue';
import { reconcileQueue } from './scheduler/reconciler';
import { closeTransports } from './worker/mailer';
import { processSendEmail } from './worker/send-email.processor';

async function main() {
  // The worker may boot before the API, so it makes sure the schema exists too.
  // The advisory lock in runMigrations stops the two from clashing.
  await runMigrations();

  const { pendingChecked, interrupted } = await reconcileQueue();
  console.log(`[worker] reconciled: ${pendingChecked} pending email(s) ensured in queue, ${interrupted} interrupted send(s) marked failed`);

  // BullMQ workers need their own connection: they block on Redis waiting for jobs.
  const connection = createRedisConnection('worker');
  const worker = new Worker<SendEmailJob, string>(EMAIL_QUEUE, processSendEmail, {
    connection,
    // How many emails this process can have in flight at once. Matters when one
    // send takes longer than the minimum gap below (slow SMTP): the next email
    // can start while the previous one is still being delivered.
    concurrency: env.WORKER_CONCURRENCY,
    // Minimum gap between sends. BullMQ stores the limiter state in Redis, so
    // "at most 1 job per MIN_DELAY_BETWEEN_SENDS_MS" holds across ALL workers
    // on this queue, not just this process. 0 = no limiter.
    ...(env.MIN_DELAY_BETWEEN_SENDS_MS > 0 && {
      limiter: { max: 1, duration: env.MIN_DELAY_BETWEEN_SENDS_MS },
    }),
  });

  worker.on('completed', (job, outcome) => console.log(`[worker] ${job.id} ${outcome}`));
  worker.on('failed', (job, err) =>
    console.warn(`[worker] ${job?.id} attempt ${job?.attemptsMade} failed: ${err.message}`),
  );
  worker.on('error', (err) => console.error('[worker] error:', err.message));

  console.log(
    `[worker] listening on queue "${EMAIL_QUEUE}" (concurrency ${env.WORKER_CONCURRENCY}, ` +
      `min gap ${env.MIN_DELAY_BETWEEN_SENDS_MS} ms, cap ${env.MAX_EMAILS_PER_HOUR_PER_SENDER}/sender/hour)`,
  );

  // Graceful shutdown: worker.close() stops taking new jobs and WAITS for the
  // emails being sent right now to finish, so a normal restart never leaves an
  // email half-sent.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] ${signal} received, finishing active jobs...`);
    setTimeout(() => process.exit(1), 30_000).unref();
    await worker.close();
    closeTransports();
    await Promise.allSettled([closeEmailQueue(), connection.quit(), redis.quit(), pool.end()]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[worker] failed to start:', err);
  process.exit(1);
});
