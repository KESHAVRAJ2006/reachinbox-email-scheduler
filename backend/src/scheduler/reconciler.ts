import { failStaleClaims, findPendingEmails } from '../emails/emails.repository';
import { enqueueEmails } from '../queue/email-queue';

// A send takes seconds. A row still 'sending' after 10 minutes has no live worker.
const STALE_CLAIM_MS = 10 * 60 * 1000;
const BATCH_SIZE = 1_000;

/**
 * Runs once when the worker starts. It makes Redis agree with Postgres again after
 * any restart or crash:
 *
 * 1. Every 'scheduled' row gets its job re-added (with the remaining delay, or 0 if
 *    overdue). Rows that still have a job are unaffected: jobId = email id, so
 *    BullMQ ignores the duplicate. Rows whose job was lost (Redis wiped, API
 *    crashed between COMMIT and enqueue) get a new one.
 * 2. Rows stuck in 'sending' are marked failed (see failStaleClaims for why).
 *
 * This is not a cron: it runs once per process start, not on a timer.
 */
export async function reconcileQueue(): Promise<{ pendingChecked: number; interrupted: number }> {
  const interrupted = await failStaleClaims(STALE_CLAIM_MS);

  let pendingChecked = 0;
  let cursor: { scheduledAt: Date; id: string } | null = null;
  for (;;) {
    const batch = await findPendingEmails(cursor, BATCH_SIZE);
    if (batch.length === 0) break;
    await enqueueEmails(batch);
    pendingChecked += batch.length;
    cursor = batch[batch.length - 1];
  }
  return { pendingChecked, interrupted };
}
