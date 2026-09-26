import type { Job } from 'bullmq';
import { claimEmail, getEmailStatus, markFailed, markSent, releaseForRetry } from '../emails/emails.repository';
import type { SendEmailJob } from '../queue/email-queue';
import { sendEmail } from './mailer';

/**
 * Runs when a delayed job becomes due. Returns a short outcome string that BullMQ
 * stores as the job's result (visible in Bull Board later).
 */
export async function processSendEmail(job: Job<SendEmailJob>): Promise<string> {
  const { emailId } = job.data;

  // Step 1: claim. Only one worker can move this row from 'scheduled' to 'sending'.
  const email = await claimEmail(emailId);
  if (!email) {
    const status = await getEmailStatus(emailId);
    if (status === 'sending') {
      // A live worker never lets this happen, because it holds the job's lock while
      // sending. So BullMQ re-delivered a job whose worker died mid-send. It may or
      // may not have reached the SMTP server; retrying could mean a duplicate.
      await markFailed(emailId, 'Worker stopped while sending; not retried so the recipient can never get it twice');
      return 'interrupted';
    }
    // Already sent/failed, or deleted: a duplicate or stale job. Nothing to do.
    return `skipped (${status ?? 'deleted'})`;
  }

  // Step 2: send, then record the outcome.
  try {
    const { messageId, previewUrl } = await sendEmail(email);
    await markSent(email.id, messageId, previewUrl);
    return 'sent';
  } catch (err) {
    const message = (err as Error).message;
    // attemptsMade = attempts that already failed before this one.
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (isLastAttempt) {
      await markFailed(email.id, message);
    } else {
      await releaseForRetry(email.id, message);
    }
    throw err; // tells BullMQ this attempt failed, so it schedules the retry
  }
}
