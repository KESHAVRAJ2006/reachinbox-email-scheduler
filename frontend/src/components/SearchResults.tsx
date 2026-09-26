import { useEffect, useState } from 'react';
import { CircleAlert, ExternalLink, SearchX } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { SearchResult } from '../lib/types';
import { EmptyState, SkeletonRows, StatusBadge } from './ui';

export function SearchResults({ query }: { query: string }) {
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If the user types again before this answer arrives, ignore the old answer,
    // so a slow response for "rep" can't overwrite the results for "report".
    let stale = false;
    setResult(null);
    setError(null);
    api.search(query).then(
      (data) => !stale && setResult(data),
      (err: Error) => !stale && setError(err.message),
    );
    return () => {
      stale = true;
    };
  }, [query]);

  if (error) return <EmptyState icon={<CircleAlert className="size-6" />} title="Search failed" description={error} />;
  if (!result) return <SkeletonRows rows={3} />;
  if (result.total === 0) {
    return (
      <EmptyState
        icon={<SearchX className="size-6" />}
        title={`No emails match "${query}"`}
        description="Search looks at subjects, recipients and email content, and tolerates small typos."
      />
    );
  }

  return (
    <div>
      <p className="border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-medium text-slate-500">
        {result.total} result{result.total === 1 ? '' : 's'} for "{query}"
      </p>
      <ul className="divide-y divide-slate-100">
        {result.hits.map((hit) => (
          <li key={hit.id} className="flex gap-4 px-5 py-4 hover:bg-slate-50/60">
            <div className="min-w-0 flex-1">
              {/* The highlight HTML comes from Elasticsearch with encoder "html": the
                  email text is already escaped and only our <mark> tags are real
                  HTML, so rendering it can't inject scripts. Everything else on the
                  page is rendered as plain text by React. */}
              <p
                className="truncate text-sm font-medium text-slate-900"
                dangerouslySetInnerHTML={{ __html: hit.highlight.subject ?? escapeHtml(hit.subject) }}
              />
              {hit.highlight.body && (
                <p className="mt-0.5 line-clamp-2 text-sm text-slate-500" dangerouslySetInnerHTML={{ __html: hit.highlight.body }} />
              )}
              <p className="mt-1 truncate text-xs text-slate-400">
                To <span className="text-slate-600">{hit.recipient}</span> · from {hit.senderEmail}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <StatusBadge status={hit.status} />
              <span className="text-xs text-slate-400">{formatDateTime(hit.sentAt ?? hit.scheduledAt)}</span>
              {hit.previewUrl && (
                <a href={hit.previewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600">
                  View <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Used when ES returns no subject highlight (the match was elsewhere), because
// that string goes through dangerouslySetInnerHTML too.
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
