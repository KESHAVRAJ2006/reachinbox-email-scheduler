import { ChevronLeft, ChevronRight, CircleAlert, ExternalLink, Inbox, Plus, SendHorizontal } from 'lucide-react';
import { formatDateTime, formatRelative } from '../lib/format';
import type { EmailPage, Tab } from '../lib/types';
import { Button, EmptyState, SkeletonRows, StatusBadge } from './ui';

type Props = {
  tab: Tab;
  data: EmailPage | null; // null = first load in progress
  error: string | null;
  pageIndex: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onCompose: () => void;
};

export function EmailTable({ tab, data, error, pageIndex, pageSize, onPageChange, onRetry, onCompose }: Props) {
  if (error) {
    return (
      <EmptyState
        icon={<CircleAlert className="size-6" />}
        title="Couldn't load emails"
        description={error}
        action={<Button variant="secondary" onClick={onRetry}>Try again</Button>}
      />
    );
  }
  if (!data) return <SkeletonRows />;

  if (data.emails.length === 0) {
    return tab === 'scheduled' ? (
      <EmptyState
        icon={<Inbox className="size-6" />}
        title="No emails scheduled"
        description="Compose a campaign and upload a CSV of recipients. Scheduled emails will appear here until they're sent."
        action={<Button onClick={onCompose}><Plus className="size-4" /> Compose campaign</Button>}
      />
    ) : (
      <EmptyState
        icon={<SendHorizontal className="size-6" />}
        title="Nothing sent yet"
        description="Emails move here as soon as a worker delivers them. Failed emails show here too, with the reason."
      />
    );
  }

  const from = pageIndex * pageSize + 1;
  const to = Math.min(from + data.emails.length - 1, data.total);

  return (
    <>
      {/* `relative` keeps absolutely-positioned children (the sr-only header label)
          inside this scroll box; without it they stretch the whole page on phones. */}
      <div className="relative overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-5 py-3">Recipient</th>
              <th className="px-5 py-3">Subject</th>
              <th className="hidden px-5 py-3 lg:table-cell">Sender</th>
              <th className="px-5 py-3">{tab === 'scheduled' ? 'Scheduled for' : 'Sent'}</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3"><span className="sr-only">Preview</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.emails.map((email) => {
              const when = tab === 'scheduled' ? email.scheduledAt : email.sentAt;
              return (
                <tr key={email.id} className="hover:bg-slate-50/60">
                  <td className="max-w-56 truncate px-5 py-3.5 font-medium text-slate-900">{email.recipient}</td>
                  <td className="max-w-72 px-5 py-3.5 text-slate-600">
                    <p className="truncate">{email.subject}</p>
                    {email.status === 'failed' && email.lastError && (
                      <p className="truncate text-xs text-rose-600" title={email.lastError}>{email.lastError}</p>
                    )}
                  </td>
                  <td className="hidden max-w-56 truncate px-5 py-3.5 text-slate-500 lg:table-cell">{email.senderEmail}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    {when ? (
                      <>
                        <p className="text-slate-700">{formatDateTime(when)}</p>
                        <p className="text-xs text-slate-400">{formatRelative(when)}</p>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={email.status} title={email.lastError ?? undefined} />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {email.previewUrl && (
                      <a
                        href={email.previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500"
                      >
                        View <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-sm text-slate-500">
        <span>
          Showing <span className="font-medium text-slate-700">{from}–{to}</span> of{' '}
          <span className="font-medium text-slate-700">{data.total}</span>
        </span>
        <div className="flex gap-1">
          <Button variant="ghost" disabled={pageIndex === 0} onClick={() => onPageChange(pageIndex - 1)} aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="ghost" disabled={to >= data.total} onClick={() => onPageChange(pageIndex + 1)} aria-label="Next page">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </>
  );
}
