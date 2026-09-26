import { pool } from '../db/pool';

// Lifecycle of one email row:
//   scheduled --(worker claims)--> sending --(SMTP accepted)--> sent
//                                     |--(temporary error, retries left)--> scheduled
//                                     '--(error on last attempt)----------> failed
export type EmailStatus = 'scheduled' | 'sending' | 'sent' | 'failed';

export type ClaimedEmail = {
  id: string;
  userId: string;
  scheduledAt: Date;
  recipient: string;
  subject: string;
  body: string;
  sender: { id: string; name: string; email: string; smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string };
};

/**
 * The idempotency guard. Moves ONE email from 'scheduled' to 'sending' and returns
 * everything needed to send it, or null if it wasn't 'scheduled'.
 *
 * Why this is safe with many workers: UPDATE locks the row. If two workers run this
 * for the same id at the same instant, the second waits for the first to commit,
 * then re-checks `status = 'scheduled'`, finds 'sending', and updates 0 rows.
 * Exactly one worker ever gets the email back, so exactly one worker sends it.
 */
export async function claimEmail(emailId: string): Promise<ClaimedEmail | null> {
  const { rows } = await pool.query(
    `WITH claimed AS (
       UPDATE emails
          SET status = 'sending', claimed_at = now(), attempts = attempts + 1, updated_at = now()
        WHERE id = $1 AND status = 'scheduled'
        RETURNING id, user_id, scheduled_at, recipient, campaign_id, sender_id
     )
     SELECT c.id, c.user_id, c.scheduled_at, c.recipient, cp.subject, cp.body,
            s.id AS sender_id, s.name AS sender_name, s.email AS sender_email,
            s.smtp_host, s.smtp_port, s.smtp_user, s.smtp_pass
       FROM claimed c
       JOIN campaigns cp ON cp.id = c.campaign_id
       JOIN senders s ON s.id = c.sender_id`,
    [emailId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    scheduledAt: row.scheduled_at,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    sender: {
      id: row.sender_id,
      name: row.sender_name,
      email: row.sender_email,
      smtpHost: row.smtp_host,
      smtpPort: row.smtp_port,
      smtpUser: row.smtp_user,
      smtpPass: row.smtp_pass,
    },
  };
}

export async function getEmailStatus(emailId: string): Promise<EmailStatus | null> {
  const { rows } = await pool.query<{ status: EmailStatus }>('SELECT status FROM emails WHERE id = $1', [emailId]);
  return rows[0]?.status ?? null;
}

export async function markSent(emailId: string, messageId: string, previewUrl: string | null): Promise<void> {
  await pool.query(
    `UPDATE emails
        SET status = 'sent', sent_at = now(), message_id = $2, preview_url = $3, last_error = NULL, updated_at = now()
      WHERE id = $1 AND status = 'sending'`,
    [emailId, messageId, previewUrl],
  );
}

// Temporary failure with retries left: hand the email back so the retry can claim it again.
export async function releaseForRetry(emailId: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE emails SET status = 'scheduled', last_error = $2, updated_at = now()
      WHERE id = $1 AND status = 'sending'`,
    [emailId, error],
  );
}

// The sender's hourly cap is full: give the claim back and record the new send time,
// so the dashboard shows when it will really go out. This is not a failed attempt,
// so the attempt counter the claim added is undone.
export async function deferEmail(emailId: string, newScheduledAt: Date): Promise<void> {
  await pool.query(
    `UPDATE emails
        SET status = 'scheduled', scheduled_at = $2, attempts = attempts - 1, claimed_at = NULL, updated_at = now()
      WHERE id = $1 AND status = 'sending'`,
    [emailId, newScheduledAt],
  );
}

export async function markFailed(emailId: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE emails SET status = 'failed', last_error = $2, updated_at = now()
      WHERE id = $1 AND status IN ('scheduled', 'sending')`,
    [emailId, error],
  );
}

/**
 * Rows stuck in 'sending' for a long time belong to a worker that crashed mid-send.
 * We can't know whether the SMTP server accepted that email, so we mark it failed
 * rather than retry: a missed email is visible and can be re-sent by a person,
 * a duplicate email can't be taken back.
 */
export async function failStaleClaims(olderThanMs: number): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE emails
        SET status = 'failed',
            last_error = 'Worker stopped while sending; not retried so the recipient can never get it twice',
            updated_at = now()
      WHERE status = 'sending' AND claimed_at < now() - make_interval(secs => $1 / 1000.0)`,
    [olderThanMs],
  );
  return rowCount ?? 0;
}

// Keyset pagination: "the next `limit` pending emails after this (time, id)". Unlike
// OFFSET, it stays fast however many rows exist, and uses emails_pending_idx.
export async function findPendingEmails(
  after: { scheduledAt: Date; id: string } | null,
  limit: number,
): Promise<{ id: string; scheduledAt: Date }[]> {
  const { rows } = await pool.query<{ id: string; scheduled_at: Date }>(
    `SELECT id, scheduled_at
       FROM emails
      WHERE status = 'scheduled' AND (scheduled_at, id) > ($1::timestamptz, $2::uuid)
      ORDER BY scheduled_at, id
      LIMIT $3`,
    [after?.scheduledAt ?? '-infinity', after?.id ?? '00000000-0000-0000-0000-000000000000', limit],
  );
  return rows.map((row) => ({ id: row.id, scheduledAt: row.scheduled_at }));
}

// Numbers for the dashboard's summary cards and tab badges, in one query.
export async function countEmailsForUser(userId: string): Promise<{ scheduled: number; sent: number; failed: number }> {
  const { rows } = await pool.query<{ scheduled: number; sent: number; failed: number }>(
    `SELECT count(*) FILTER (WHERE status IN ('scheduled', 'sending'))::int AS scheduled,
            count(*) FILTER (WHERE status = 'sent')::int AS sent,
            count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM emails WHERE user_id = $1`,
    [userId],
  );
  return rows[0];
}

export type EmailListItem = {
  id: string;
  recipient: string;
  subject: string;
  senderEmail: string;
  status: EmailStatus;
  scheduledAt: Date;
  sentAt: Date | null;
  previewUrl: string | null;
  lastError: string | null;
};

// The dashboard's two tabs. "scheduled" includes emails being sent right now;
// "sent" includes failures so the user can see what went wrong.
const TABS = {
  scheduled: { statuses: ['scheduled', 'sending'], orderBy: 'e.scheduled_at ASC, e.id' },
  sent: { statuses: ['sent', 'failed'], orderBy: 'COALESCE(e.sent_at, e.updated_at) DESC, e.id' },
} as const;
export type EmailTab = keyof typeof TABS;

export async function listEmailsForUser(
  userId: string,
  tab: EmailTab,
  limit: number,
  offset: number,
): Promise<{ emails: EmailListItem[]; total: number }> {
  const { statuses, orderBy } = TABS[tab];
  // orderBy comes from the fixed TABS map above, never from user input, so
  // putting it into the SQL string can't cause SQL injection.
  const { rows } = await pool.query(
    `SELECT e.id, e.recipient, cp.subject, s.email AS sender_email, e.status,
            e.scheduled_at, e.sent_at, e.preview_url, e.last_error,
            count(*) OVER () AS total
       FROM emails e
       JOIN campaigns cp ON cp.id = e.campaign_id
       JOIN senders s ON s.id = e.sender_id
      WHERE e.user_id = $1 AND e.status = ANY($2)
      ORDER BY ${orderBy}
      LIMIT $3 OFFSET $4`,
    [userId, statuses, limit, offset],
  );
  return {
    total: rows[0] ? Number(rows[0].total) : 0,
    emails: rows.map((row) => ({
      id: row.id,
      recipient: row.recipient,
      subject: row.subject,
      senderEmail: row.sender_email,
      status: row.status,
      scheduledAt: row.scheduled_at,
      sentAt: row.sent_at,
      previewUrl: row.preview_url,
      lastError: row.last_error,
    })),
  };
}
