/**
 * Rebuilds the Elasticsearch search copy from Postgres (the source of truth).
 *   npm run reindex            upsert every email into the existing index
 *   npm run reindex -- --fresh delete the index first (e.g. after changing the mapping)
 *
 * Use it after ES was down, wiped, or when the index looks out of date. Documents
 * use the email id as _id, so running it twice never creates duplicates.
 */
import { pool } from '../db/pool';
import { elastic } from '../lib/elastic';
import { EMAIL_INDEX, ensureEmailIndex, indexEmailDocs, type EmailDoc } from '../search/email-index';

const BATCH_SIZE = 1_000;

async function main() {
  if (process.argv.includes('--fresh')) {
    await elastic.indices.delete({ index: EMAIL_INDEX, ignore_unavailable: true });
    console.log(`Deleted index "${EMAIL_INDEX}"`);
  }
  await ensureEmailIndex();

  let lastId = '00000000-0000-0000-0000-000000000000';
  let total = 0;
  for (;;) {
    // Keyset pagination on id: stays fast however many emails there are.
    const { rows } = await pool.query(
      `SELECT e.id, e.user_id, e.campaign_id, s.email AS sender_email, e.recipient, cp.subject, cp.body,
              e.status, e.scheduled_at, e.sent_at, e.preview_url
         FROM emails e
         JOIN campaigns cp ON cp.id = e.campaign_id
         JOIN senders s ON s.id = e.sender_id
        WHERE e.id > $1
        ORDER BY e.id
        LIMIT $2`,
      [lastId, BATCH_SIZE],
    );
    if (rows.length === 0) break;

    await indexEmailDocs(
      rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        campaignId: row.campaign_id,
        senderEmail: row.sender_email,
        recipient: row.recipient,
        subject: row.subject,
        body: row.body,
        status: row.status as EmailDoc['status'],
        scheduledAt: row.scheduled_at.toISOString(),
        sentAt: row.sent_at ? row.sent_at.toISOString() : null,
        previewUrl: row.preview_url,
      })),
    );
    total += rows.length;
    lastId = rows[rows.length - 1].id;
    console.log(`Indexed ${total} email(s)...`);
  }

  // Make the new documents searchable right away instead of within ~1 s.
  await elastic.indices.refresh({ index: EMAIL_INDEX });
  console.log(`Done: ${total} email(s) in "${EMAIL_INDEX}"`);
}

main()
  .catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await elastic.close();
    await pool.end();
  });
