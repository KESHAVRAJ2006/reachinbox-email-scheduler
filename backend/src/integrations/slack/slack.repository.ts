import { pool } from '../../db/pool';
import type { SlackInstall } from './slack.oauth';

// One connection per user. Connecting again (e.g. to a different channel) replaces it.
export async function saveSlackConnection(userId: string, install: SlackInstall): Promise<void> {
  await pool.query(
    `INSERT INTO slack_connections (user_id, team_name, channel_name, webhook_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE
       SET team_name = EXCLUDED.team_name,
           channel_name = EXCLUDED.channel_name,
           webhook_url = EXCLUDED.webhook_url,
           connected_at = now()`,
    [userId, install.teamName, install.channelName, install.webhookUrl],
  );
}

export async function deleteSlackConnection(userId: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM slack_connections WHERE user_id = $1', [userId]);
  return (rowCount ?? 0) > 0;
}

// The webhook URL is a secret (anyone holding it can post to the channel), so it is
// only ever read here, on the server, and never returned by the API.
export async function findWebhookUrl(userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ webhook_url: string }>(
    'SELECT webhook_url FROM slack_connections WHERE user_id = $1',
    [userId],
  );
  return rows[0]?.webhook_url ?? null;
}

/**
 * Who should hear that a sender is full for this hour? The user whose email took
 * the last slot, plus every user with emails for this sender still due before the
 * hour ends, because those are the emails that will now be pushed back.
 * Users without a Slack connection simply don't appear (no connection = no message).
 */
export async function findWebhooksAffectedBySender(
  triggeringUserId: string,
  senderId: string,
  hourEnds: Date,
): Promise<{ userId: string; webhookUrl: string }[]> {
  const { rows } = await pool.query<{ user_id: string; webhook_url: string }>(
    `SELECT sc.user_id, sc.webhook_url
       FROM slack_connections sc
      WHERE sc.user_id = $1
         OR sc.user_id IN (
              SELECT DISTINCT user_id FROM emails
               WHERE sender_id = $2
                 AND status IN ('scheduled', 'sending')
                 AND scheduled_at < $3)`,
    [triggeringUserId, senderId, hourEnds],
  );
  return rows.map((row) => ({ userId: row.user_id, webhookUrl: row.webhook_url }));
}
