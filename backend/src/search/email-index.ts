import { elastic } from '../lib/elastic';
import { pool } from '../db/pool';
import type { EmailStatus, EmailTab } from '../emails/emails.repository';

/**
 * Elasticsearch holds a SEARCH COPY of the emails table. Postgres stays the source
 * of truth. If an index write fails (ES down), sending carries on and
 * `npm run reindex` rebuilds the copy from Postgres. That's why every write here is
 * "best effort": it logs and never throws into the scheduling/sending path.
 *
 * Without ELASTICSEARCH_URL, writes are skipped and search queries Postgres directly.
 */
export const EMAIL_INDEX = 'emails';

export type EmailDoc = {
  userId: string;
  campaignId: string;
  senderEmail: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  previewUrl: string | null;
};

// The mapping tells ES how to store each field:
//  - keyword: exact values, used for filters ("userId = X", "status = sent")
//  - text:    split into words and analysed, used for full-text search
//  - date:    real timestamps, for sorting and ranges
const MAPPINGS = {
  properties: {
    userId: { type: 'keyword' },
    campaignId: { type: 'keyword' },
    senderEmail: { type: 'keyword' },
    recipient: { type: 'text', fields: { exact: { type: 'keyword' } } },
    subject: { type: 'text' },
    body: { type: 'text' },
    status: { type: 'keyword' },
    scheduledAt: { type: 'date' },
    sentAt: { type: 'date' },
    previewUrl: { type: 'keyword', index: false }, // stored, never searched
  },
} as const;

// Safe to call on every start. Creates the index only if it doesn't exist yet.
export async function ensureEmailIndex(): Promise<void> {
  if (!elastic) return;
  if (await elastic.indices.exists({ index: EMAIL_INDEX })) return;
  try {
    await elastic.indices.create({ index: EMAIL_INDEX, mappings: MAPPINGS });
    console.log(`[search] created index "${EMAIL_INDEX}"`);
  } catch (err) {
    // The API and the worker may both try at the same moment; losing that race is fine.
    if (!String((err as Error).message).includes('resource_already_exists_exception')) throw err;
  }
}

// Many documents in one request. _id = email id, so writing the same email again
// overwrites it instead of creating a duplicate.
export async function indexEmailDocs(docs: ({ id: string } & EmailDoc)[]): Promise<void> {
  if (!elastic || docs.length === 0) return;
  const result = await elastic.bulk({
    operations: docs.flatMap(({ id, ...doc }) => [{ index: { _index: EMAIL_INDEX, _id: id } }, doc]),
  });
  // A bulk request can "succeed" while some items fail; check them.
  if (result.errors) {
    const firstError = result.items.find((item) => item.index?.error)?.index?.error;
    throw new Error(`bulk index had errors, e.g. ${firstError?.reason ?? 'unknown'}`);
  }
}

// Changes a few fields of one document (e.g. status -> sent), leaving the rest.
export async function updateEmailDoc(id: string, changes: Partial<EmailDoc>): Promise<void> {
  if (!elastic) return;
  await elastic.update({ index: EMAIL_INDEX, id, doc: changes, retry_on_conflict: 3 });
}

// Wrapper for the hot path: never throws, only logs.
export function indexInBackground(label: string, work: () => Promise<void>): void {
  work().catch((err: Error) => console.warn(`[search] ${label} failed (npm run reindex will repair it):`, err.message));
}

const TAB_STATUSES: Record<EmailTab, EmailStatus[]> = {
  scheduled: ['scheduled', 'sending'],
  sent: ['sent', 'failed'],
};

export type SearchHit = EmailDoc & { id: string; score: number; highlight: { subject?: string; body?: string } };

export async function searchEmails(
  userId: string,
  opts: { q: string; tab?: EmailTab; limit: number; offset: number },
): Promise<{ total: number; hits: SearchHit[] }> {
  if (!elastic) return searchEmailsInPostgres(userId, opts);

  const result = await elastic.search<EmailDoc>({
    index: EMAIL_INDEX,
    from: opts.offset,
    size: opts.limit,
    query: {
      bool: {
        // filter = must match, but doesn't affect ranking. The userId filter is the
        // security boundary: a user can only ever find their own emails.
        filter: [{ term: { userId } }, ...(opts.tab ? [{ terms: { status: TAB_STATUSES[opts.tab] } }] : [])],
        // Two ways to match; either one is enough (minimum_should_match: 1).
        should: [
          {
            // Whole words, tolerating typos: "shedule" still finds "schedule".
            multi_match: {
              query: opts.q,
              // ^3 / ^2 = a match in the subject counts 3x, in the recipient 2x.
              fields: ['subject^3', 'recipient^2', 'body'],
              fuzziness: 'AUTO',
            },
          },
          {
            // The last word may be unfinished ("welc" finds "welcome"), so results
            // update while the user is still typing. ES doesn't apply fuzziness to
            // that last prefix word, which is why the fuzzy match above is needed too.
            multi_match: {
              query: opts.q,
              type: 'bool_prefix',
              fields: ['subject^3', 'recipient^2', 'body'],
            },
          },
        ],
        minimum_should_match: 1,
      },
    },
    sort: ['_score', { scheduledAt: 'desc' }],
    highlight: {
      // encoder "html" escapes the email text before adding <mark> tags, so the
      // frontend can render the snippet as HTML without an injection risk.
      encoder: 'html',
      pre_tags: ['<mark>'],
      post_tags: ['</mark>'],
      fields: { subject: { number_of_fragments: 0 }, body: { fragment_size: 120, number_of_fragments: 1 } },
    },
  });

  const total = typeof result.hits.total === 'number' ? result.hits.total : (result.hits.total?.value ?? 0);
  return {
    total,
    hits: result.hits.hits.map((hit) => ({
      id: hit._id!,
      score: hit._score ?? 0,
      ...(hit._source as EmailDoc),
      highlight: { subject: hit.highlight?.subject?.[0], body: hit.highlight?.body?.[0] },
    })),
  };
}

/**
 * Fallback when Elasticsearch isn't configured. Every word of the query must appear
 * (case-insensitive substring) in the subject, recipient or body. No typo tolerance
 * or ranking, but the response has the same shape, highlights included.
 */
async function searchEmailsInPostgres(
  userId: string,
  opts: { q: string; tab?: EmailTab; limit: number; offset: number },
): Promise<{ total: number; hits: SearchHit[] }> {
  const words = opts.q.split(/\s+/).filter(Boolean).slice(0, 10);
  // Escape LIKE wildcards so "%" or "_" typed by the user match literally.
  const patterns = words.map((word) => `%${word.replace(/[\\%_]/g, '\\$&')}%`);

  const { rows } = await pool.query(
    `SELECT e.id, e.user_id, e.campaign_id, s.email AS sender_email, e.recipient, cp.subject, cp.body,
            e.status, e.scheduled_at, e.sent_at, e.preview_url, count(*) OVER () AS total
       FROM emails e
       JOIN campaigns cp ON cp.id = e.campaign_id
       JOIN senders s ON s.id = e.sender_id
      WHERE e.user_id = $1
        AND ($2::text[] IS NULL OR e.status = ANY($2))
        AND NOT EXISTS (
          SELECT 1 FROM unnest($3::text[]) AS p(pattern)
           WHERE NOT (cp.subject ILIKE p.pattern OR e.recipient ILIKE p.pattern OR cp.body ILIKE p.pattern)
        )
      ORDER BY e.scheduled_at DESC
      LIMIT $4 OFFSET $5`,
    [userId, opts.tab ? TAB_STATUSES[opts.tab] : null, patterns, opts.limit, opts.offset],
  );

  return {
    total: rows.length ? Number(rows[0].total) : 0,
    hits: rows.map((row) => ({
      id: row.id,
      score: 0,
      userId: row.user_id,
      campaignId: row.campaign_id,
      senderEmail: row.sender_email,
      recipient: row.recipient,
      subject: row.subject,
      body: row.body,
      status: row.status,
      scheduledAt: row.scheduled_at.toISOString(),
      sentAt: row.sent_at ? row.sent_at.toISOString() : null,
      previewUrl: row.preview_url,
      highlight: { subject: highlight(row.subject, words), body: highlightSnippet(row.body, words) },
    })),
  };
}

// Same contract as Elasticsearch's encoder "html": the text is escaped first and only
// our own <mark> tags are real HTML, so the frontend can render it safely.
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function highlight(text: string, words: string[]): string | undefined {
  const alternatives = words.map((word) => word.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`(${alternatives})`, 'i');
  // With a capture group, split() keeps the matches at the odd positions.
  const parts = text.split(pattern);
  if (parts.length === 1) return undefined;
  return parts.map((part, i) => (i % 2 === 1 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part))).join('');
}

// About 120 characters of the body around the first match, like ES's fragment_size.
function highlightSnippet(body: string, words: string[]): string | undefined {
  const lower = body.toLowerCase();
  const first = Math.min(...words.map((w) => lower.indexOf(w.toLowerCase())).filter((i) => i >= 0));
  if (!Number.isFinite(first)) return undefined;
  const start = Math.max(0, first - 40);
  return highlight(body.slice(start, start + 120), words);
}
