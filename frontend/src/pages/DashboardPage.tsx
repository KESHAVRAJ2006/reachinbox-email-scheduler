import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { CircleCheck, Clock, Plus, TriangleAlert } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ComposeModal } from '../components/ComposeModal';
import { EmailTable } from '../components/EmailTable';
import { Header } from '../components/Header';
import { SearchResults } from '../components/SearchResults';
import { useToast } from '../components/Toasts';
import { Button } from '../components/ui';
import { api } from '../lib/api';
import type { EmailPage, EmailStats, Tab } from '../lib/types';
import { useDebounce } from '../lib/useDebounce';

const PAGE_SIZE = 25;
// While the dashboard is visible, refresh every 5 s so users watch emails move from
// Scheduled to Sent. This is the browser re-reading the API, not a server cron.
const REFRESH_MS = 5_000;

const SLACK_ERRORS: Record<string, string> = {
  access_denied: 'You cancelled the Slack authorisation.',
  invalid_state: 'The Slack link expired. Please try again.',
  slack_connect_failed: 'Slack rejected the connection. Please try again.',
};

export default function DashboardPage() {
  const toast = useToast();
  const { refreshUser } = useAuth();
  const [params, setParams] = useSearchParams();

  const [tab, setTab] = useState<Tab>('scheduled');
  const [pageIndex, setPageIndex] = useState(0);
  const [page, setPage] = useState<EmailPage | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchTerm = useDebounce(query.trim(), 300);

  // Each load gets a number; only the newest one may update the screen. Otherwise a
  // slow response for the old tab could overwrite the tab you just switched to.
  const latestLoad = useRef(0);
  const load = useCallback(
    async (showSkeleton: boolean) => {
      const loadId = ++latestLoad.current;
      if (showSkeleton) {
        setPage(null);
        setPageError(null);
      }
      try {
        const [emails, counts] = await Promise.all([api.emails(tab, PAGE_SIZE, pageIndex * PAGE_SIZE), api.stats()]);
        if (loadId !== latestLoad.current) return;
        setPage(emails);
        setStats(counts);
        setPageError(null);
      } catch (err) {
        if (loadId === latestLoad.current && showSkeleton) setPageError((err as Error).message);
      }
    },
    [tab, pageIndex],
  );

  // Load now, then refresh in the background while the tab is visible.
  useEffect(() => {
    void load(true);
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(false), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Coming back from Slack: /?slack=connected&channel=%23alerts or /?slack=error&reason=...
  const handledSlackResult = useRef<string | null>(null);
  useEffect(() => {
    const result = params.get('slack');
    if (!result || handledSlackResult.current === params.toString()) return;
    handledSlackResult.current = params.toString();
    if (result === 'connected') {
      toast.success('Slack connected', `Limit alerts will be posted to ${params.get('channel') ?? 'your channel'}.`);
      void refreshUser();
    } else {
      const reason = params.get('reason') ?? '';
      toast.error('Slack connection failed', SLACK_ERRORS[reason] ?? reason);
    }
    setParams({}, { replace: true }); // clean the URL so a refresh doesn't repeat the toast
  }, [params, setParams, toast, refreshUser]);

  function switchTab(next: Tab) {
    setTab(next);
    setPageIndex(0);
    setQuery('');
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header query={query} onQueryChange={setQuery} />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Campaigns</h1>
            <p className="mt-1 text-sm text-slate-500">Schedule emails, then watch them go out. Updates every few seconds.</p>
          </div>
          <Button onClick={() => setComposeOpen(true)}>
            <Plus className="size-4" /> Compose
          </Button>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard label="Scheduled" value={stats?.scheduled} icon={<Clock className="size-5" />} tone="indigo" onClick={() => switchTab('scheduled')} />
          <StatCard label="Sent" value={stats?.sent} icon={<CircleCheck className="size-5" />} tone="emerald" onClick={() => switchTab('sent')} />
          <StatCard label="Failed" value={stats?.failed} icon={<TriangleAlert className="size-5" />} tone="rose" onClick={() => switchTab('sent')} />
        </div>

        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          {searchTerm ? (
            <SearchResults query={searchTerm} />
          ) : (
            <>
              <div role="tablist" className="flex gap-6 border-b border-slate-200 px-5">
                <TabButton active={tab === 'scheduled'} count={stats?.scheduled} onClick={() => switchTab('scheduled')}>Scheduled</TabButton>
                <TabButton active={tab === 'sent'} count={stats ? stats.sent + stats.failed : undefined} onClick={() => switchTab('sent')}>Sent</TabButton>
              </div>
              <EmailTable
                tab={tab}
                data={page}
                error={pageError}
                pageIndex={pageIndex}
                pageSize={PAGE_SIZE}
                onPageChange={setPageIndex}
                onRetry={() => void load(true)}
                onCompose={() => setComposeOpen(true)}
              />
            </>
          )}
        </section>
      </main>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onScheduled={() => {
          switchTab('scheduled');
          void load(false);
        }}
      />
    </div>
  );
}

const TONES = {
  indigo: 'bg-indigo-50 text-indigo-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  rose: 'bg-rose-50 text-rose-600',
};

function StatCard({ label, value, icon, tone, onClick }: { label: string; value?: number; icon: ReactNode; tone: keyof typeof TONES; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-4 rounded-2xl bg-white p-5 text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-slate-300">
      <span className={`rounded-xl p-2.5 ${TONES[tone]}`}>{icon}</span>
      <span>
        <span className="block text-sm text-slate-500">{label}</span>
        <span className="block text-2xl font-semibold text-slate-900">
          {value === undefined ? <span className="inline-block h-7 w-10 animate-pulse rounded bg-slate-200 align-middle" /> : value.toLocaleString()}
        </span>
      </span>
    </button>
  );
}

function TabButton({ active, count, onClick, children }: { active: boolean; count?: number; onClick: () => void; children: ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px flex items-center gap-2 border-b-2 py-3.5 text-sm font-medium transition ${
        active ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
      {count !== undefined && (
        <span className={`rounded-full px-2 py-0.5 text-xs ${active ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}
