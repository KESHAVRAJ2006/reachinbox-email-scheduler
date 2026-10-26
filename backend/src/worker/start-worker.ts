import { Worker } from 'bullmq';
import { env } from '../config/env';
import { createRedisConnection } from '../lib/redis';
import { EMAIL_QUEUE, type SendEmailJob } from '../queue/email-queue';
import { reconcileQueue } from '../scheduler/reconciler';
import { closeTransports } from './mailer';
import { processSendEmail } from './send-email.processor';

/**
 * Reconciles the queue with Postgres, then starts consuming jobs. Used by the
 * standalone worker (src/worker.ts) and by the API when RUN_WORKER_IN_API=true.
 * Migrations must already have run. Returns a function that stops the worker
 * gracefully: it stops taking new jobs and WAITS for the emails being sent right
 * now to finish, so a normal restart never leaves an email half-sent.
 */
export async function startWorker(): Promise<() => Promise<void>> {
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

  return async () => {
    await worker.close();
    closeTransports();
    await connection.quit();
  };
}
