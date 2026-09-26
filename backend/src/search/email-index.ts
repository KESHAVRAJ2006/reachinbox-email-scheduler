import { elastic } from '../lib/elastic';
import type { EmailStatus, EmailTab } from '../emails/emails.repository';

/**
 * Elasticsearch holds a SEARCH COPY of the emails table. Postgres stays the source
 * of truth. If an index write fails (ES down), sending carries on and
 * `npm run reindex` rebuilds the copy from Postgres. That's why every write here is
 * "best effort": it logs and never throws into the scheduling/sending path.
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
  if (docs.length === 0) return;
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
