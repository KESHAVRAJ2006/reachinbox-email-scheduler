import { DelayedError, type Job } from 'bullmq';
import { claimEmail, deferEmail, getEmailStatus, markFailed, markSent, releaseForRetry } from '../emails/emails.repository';
import { notifySenderLimitReached } from '../integrations/slack/slack.notifier';
import type { SendEmailJob } from '../queue/email-queue';
import { overflowSendTime } from '../scheduler/planner';
import { indexInBackground, updateEmailDoc } from '../search/email-index';
import { sendEmail } from './mailer';
import { reserveSenderSlot } from './sender-rate-limit';

const INTERRUPTED_MESSAGE = 'Worker stopped while sending; not retried so the recipient can never get it twice';

/**
 * Runs when a delayed job becomes due. Returns a short outcome string that BullMQ
 * stores as the job's result (visible in Bull Board).
 * `token` identifies this worker's lock on the job; BullMQ needs it for moveToDelayed.
 */
export async function processSendEmail(job: Job<SendEmailJob>, token?: string): Promise<string> {
  const { emailId } = job.data;

  // Step 1: claim. Only one worker can move this row from 'scheduled' to 'sending'.
  const email = await claimEmail(emailId);
  if (!email) {
    const status = await getEmailStatus(emailId);
    if (status === 'sending') {
      // A live worker never lets this happen, because it holds the job's lock while
      // sending. So BullMQ re-delivered a job whose worker died mid-send. It may or
      // may not have reached the SMTP server; retrying could mean a duplicate.
      await markFailed(emailId, INTERRUPTED_MESSAGE);
      indexInBackground('mark interrupted', () => updateEmailDoc(emailId, { status: 'failed' }));
      return 'interrupted';
    }
    // Already sent/failed, or deleted: a duplicate or stale job. Nothing to do.
    return `skipped (${status ?? 'deleted'})`;
  }

  // Step 2: per-sender hourly cap, shared by all workers through Redis.
  // We claim first, so only an email we're definitely about to send uses a slot.
  const slot = await reserveSenderSlot(email.sender.id);
  if (!slot.allowed) {
    // Hour is full. Never drop or fail the email: push it to the next hour, keeping
    // its place in line, and update the database first so Postgres stays the truth.
    const runAt = overflowSendTime(email.scheduledAt.getTime(), slot.window);
    await deferEmail(email.id, new Date(runAt));
    await job.moveToDelayed(runAt, token);
    indexInBackground('record deferral', () => updateEmailDoc(email.id, { scheduledAt: new Date(runAt).toISOString() }));
    console.log(`[worker] ${email.id} deferred to ${new Date(runAt).toISOString()} (${email.sender.email} hit ${slot.limit}/hour)`);
    // Tells BullMQ "this job was moved on purpose": not completed, not failed.
    throw new DelayedError();
  }
  if (slot.used === slot.limit) {
    // Exactly one reservation per sender per hour sees used === limit, because the
    // Lua script is atomic, so the alert fires exactly once. Not awaited: sending
    // this email must not wait for Slack. The notifier never throws.
    console.log(`[worker] ${email.sender.email} reached its limit of ${slot.limit} emails this hour`);
    void notifySenderLimitReached({
      triggeringUserId: email.userId,
      sender: { id: email.sender.id, email: email.sender.email },
      limit: slot.limit,
      window: slot.window,
    });
  }

  // Step 3: send, then record the outcome.
  try {
    const { messageId, previewUrl } = await sendEmail(email);
    await markSent(email.id, messageId, previewUrl);
    indexInBackground('record send', () =>
      updateEmailDoc(email.id, { status: 'sent', sentAt: new Date().toISOString(), previewUrl }),
    );
    return 'sent';
  } catch (err) {
    const message = (err as Error).message;
    // attemptsMade = attempts that already failed before this one.
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (isLastAttempt) {
      await markFailed(email.id, message);
      indexInBackground('record failure', () => updateEmailDoc(email.id, { status: 'failed' }));
    } else {
      await releaseForRetry(email.id, message);
    }
    throw err; // tells BullMQ this attempt failed, so it schedules the retry
  }
}
