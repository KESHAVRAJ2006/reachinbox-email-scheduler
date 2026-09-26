import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { createRedisConnection } from '../lib/redis';

export const EMAIL_QUEUE = 'email-send';

// The job carries only the email id. Everything else (recipient, sender, status) is
// read from Postgres at send time, so the database stays the single source of truth.
export type SendEmailJob = { emailId: string };

export const SEND_JOB_OPTIONS: JobsOptions = {
  // SMTP can fail temporarily (server busy, network blip). Retry up to 5 times with
  // growing waits: 30 s, 60 s, 120 s, 240 s.
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  // Keep finished jobs around for a while so the Bull Board dashboard can show them,
  // but don't let Redis grow forever.
  removeOnComplete: { age: 24 * 60 * 60, count: 5_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

let connection: Redis | undefined;
let queue: Queue<SendEmailJob> | undefined;

// Created on first use, so processes that never enqueue don't open a Redis connection.
export function getEmailQueue(): Queue<SendEmailJob> {
  if (!queue) {
    connection = createRedisConnection('queue');
    queue = new Queue<SendEmailJob>(EMAIL_QUEUE, { connection });
  }
  return queue;
}

/**
 * Adds one delayed job per email. This is safe to call again for the same emails:
 * jobId = email id, and BullMQ ignores an add whose jobId already exists. That is
 * what lets the restart reconciler re-add "everything pending" without ever
 * creating a duplicate job.
 */
export async function enqueueEmails(emails: { id: string; scheduledAt: Date }[]): Promise<void> {
  const now = Date.now();
  const CHUNK = 500; // one Redis round-trip per 500 jobs
  for (let i = 0; i < emails.length; i += CHUNK) {
    await getEmailQueue().addBulk(
      emails.slice(i, i + CHUNK).map((email) => ({
        name: 'send',
        data: { emailId: email.id },
        opts: {
          ...SEND_JOB_OPTIONS,
          jobId: email.id,
          // Already overdue (e.g. the server was down at send time) = send now.
          delay: Math.max(0, email.scheduledAt.getTime() - now),
        },
      })),
    );
  }
}

export async function closeEmailQueue(): Promise<void> {
  await queue?.close();
  await connection?.quit();
}
