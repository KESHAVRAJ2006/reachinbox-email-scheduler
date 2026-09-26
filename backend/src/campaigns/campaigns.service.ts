import { z } from 'zod';
import { pool } from '../db/pool';
import { HttpError } from '../http/errors';
import { enqueueEmails } from '../queue/email-queue';
import { planSendTimes } from '../scheduler/planner';
import { indexEmailDocs, indexInBackground } from '../search/email-index';
import { findSenderById } from '../senders/senders.repository';

const MAX_RECIPIENTS = 10_000;
const MAX_START_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

// Body of POST /api/campaigns. The frontend parses the CSV and sends plain addresses.
export const createCampaignSchema = z.object({
  senderId: z.uuid(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  // Normalise first ("  Bob@X.com " -> "bob@x.com") so duplicates can be detected.
  recipients: z.array(z.string().trim().toLowerCase().pipe(z.email())).min(1).max(MAX_RECIPIENTS),
  startAt: z.iso.datetime({ offset: true }), // e.g. "2026-09-27T09:00:00+05:30"
  delayBetweenMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  hourlyLimit: z.number().int().min(1).max(100_000),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export async function scheduleCampaign(userId: string, input: CreateCampaignInput) {
  const sender = await findSenderById(input.senderId);
  if (!sender) throw new HttpError(400, 'Unknown sender');

  const recipients = [...new Set(input.recipients)];
  // A start time in the past (or a slow form submit) means "start now".
  const startAt = Math.max(Date.parse(input.startAt), Date.now());
  if (startAt - Date.now() > MAX_START_AHEAD_MS) throw new HttpError(400, 'startAt must be within one year');

  const sendTimes = planSendTimes({
    count: recipients.length,
    startAt,
    delayBetweenMs: input.delayBetweenMs,
    hourlyLimit: input.hourlyLimit,
  });

  // 1) Save everything in ONE transaction: the campaign and all its emails exist, or none do.
  const client = await pool.connect();
  let campaignId: string;
  let emails: { id: string; recipient: string; scheduledAt: Date }[];
  try {
    await client.query('BEGIN');
    const campaign = await client.query<{ id: string }>(
      `INSERT INTO campaigns (user_id, sender_id, subject, body, start_at, delay_between_ms, hourly_limit, total_emails)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [userId, sender.id, input.subject, input.body, new Date(startAt), input.delayBetweenMs, input.hourlyLimit, recipients.length],
    );
    campaignId = campaign.rows[0].id;

    // unnest() turns two parallel arrays into rows: one INSERT for thousands of
    // emails instead of thousands of round-trips.
    const inserted = await client.query<{ id: string; recipient: string; scheduled_at: Date }>(
      `INSERT INTO emails (campaign_id, user_id, sender_id, recipient, scheduled_at)
       SELECT $1, $2, $3, recipient, scheduled_at
         FROM unnest($4::text[], $5::timestamptz[]) AS planned(recipient, scheduled_at)
       RETURNING id, recipient, scheduled_at`,
      [campaignId, userId, sender.id, recipients, sendTimes.map((t) => new Date(t))],
    );
    emails = inserted.rows.map((row) => ({ id: row.id, recipient: row.recipient, scheduledAt: row.scheduled_at }));
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 2) Only after COMMIT, create the delayed jobs. The other order is unsafe: a job
  //    due "now" could run before the rows are visible, find nothing, and finish.
  //    If Redis fails here, the rows are safe in Postgres and the worker's startup
  //    reconciler will queue them.
  try {
    await enqueueEmails(emails);
  } catch (err) {
    console.error('[campaigns] saved but could not enqueue:', (err as Error).message);
    throw new HttpError(503, 'Campaign saved, but the queue is unavailable. It will be queued automatically when the worker restarts.');
  }

  // 3) Make the new emails searchable. Best effort: search is a copy, not the truth.
  indexInBackground('index new campaign', () =>
    indexEmailDocs(
      emails.map((email) => ({
        id: email.id,
        userId,
        campaignId,
        senderEmail: sender.email,
        recipient: email.recipient,
        subject: input.subject,
        body: input.body,
        status: 'scheduled',
        scheduledAt: email.scheduledAt.toISOString(),
        sentAt: null,
        previewUrl: null,
      })),
    ),
  );

  return {
    campaignId,
    totalEmails: recipients.length,
    duplicatesRemoved: input.recipients.length - recipients.length,
    firstSendAt: new Date(sendTimes[0]),
    lastSendAt: new Date(sendTimes[sendTimes.length - 1]),
  };
}
