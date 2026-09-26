import { useEffect, useRef, useState } from 'react';
import { Hash, LogOut, Mail, MessageSquare, Search, Send, Unplug, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { Menu, MenuItem } from './Menu';
import { useToast } from './Toasts';
import { Button } from './ui';

export function Header({ query, onQueryChange }: { query: string; onQueryChange: (value: string) => void }) {
  const searchRef = useRef<HTMLInputElement>(null);

  // Press "/" anywhere (outside a text field) to jump to search, like GitHub or Gmail.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <div className="flex shrink-0 items-center gap-2 font-semibold text-slate-900">
          <span className="grid size-8 place-items-center rounded-lg bg-indigo-600 text-white">
            <Mail className="size-4" />
          </span>
          <span className="hidden md:inline">Email Scheduler</span>
        </div>

        <div className="relative mx-auto w-full max-w-lg">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && onQueryChange('')}
            placeholder="Search subject, recipient or content"
            aria-label="Search emails"
            className="w-full rounded-lg border-0 bg-slate-100 py-2 pr-9 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button onClick={() => onQueryChange('')} aria-label="Clear search" className="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="size-4" />
            </button>
          ) : (
            <kbd className="absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-slate-300 px-1.5 text-xs text-slate-400 sm:block">/</kbd>
          )}
        </div>

        <SlackButton />
        <UserMenu />
      </div>
    </header>
  );
}

function SlackButton() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  async function connect() {
    setBusy(true);
    try {
      // The API gives us Slack's consent URL (with a signed state), and we leave
      // the app to go there. Slack sends the browser back with ?slack=connected.
      const { url } = await api.slackConnect();
      window.location.assign(url);
    } catch (err) {
      toast.error('Could not start Slack connection', (err as Error).message);
      setBusy(false);
    }
  }

  if (!user.slack.connected) {
    return (
      <Button variant="secondary" loading={busy} onClick={() => void connect()} className="shrink-0">
        {!busy && <MessageSquare className="size-4" />}
        <span className="hidden sm:inline">Connect Slack</span>
      </Button>
    );
  }

  return (
    <Menu
      label="Slack settings"
      trigger={
        <span className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200 ring-inset">
          <span className="size-2 rounded-full bg-emerald-500" />
          <Hash className="hidden size-3.5 sm:block" />
          <span className="hidden max-w-32 truncate sm:inline">{user.slack.channel?.replace(/^#/, '')}</span>
        </span>
      }
    >
      {(close) => (
        <>
          <p className="border-b border-slate-100 px-4 pt-2 pb-3 text-xs text-slate-500">
            Limit alerts are posted to <span className="font-medium text-slate-700">{user.slack.channel}</span>
          </p>
          <MenuItem
            icon={<Send className="size-4" />}
            onClick={() => {
              close();
              api.slackTest().then(
                () => toast.success('Test message sent', `Check ${user.slack.channel} in Slack.`),
                (err: Error) => toast.error('Slack test failed', err.message),
              );
            }}
          >
            Send test message
          </MenuItem>
          <MenuItem
            danger
            icon={<Unplug className="size-4" />}
            onClick={() => {
              close();
              api.slackDisconnect().then(
                () => {
                  toast.info('Slack disconnected', 'You will no longer receive limit alerts.');
                  void refreshUser();
                },
                (err: Error) => toast.error('Could not disconnect', err.message),
              );
            }}
          >
            Disconnect Slack
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  if (!user) return null;
  const initials = user.name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();

  return (
    <Menu
      label="Account"
      trigger={
        user.avatarUrl ? (
          // no-referrer: Google's avatar CDN sometimes refuses requests that carry a Referer
          <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-9 rounded-full ring-2 ring-white" />
        ) : (
          <span className="grid size-9 place-items-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">{initials}</span>
        )
      }
    >
      {() => (
        <>
          <div className="border-b border-slate-100 px-4 pt-2 pb-3">
            <p className="truncate text-sm font-medium text-slate-900">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>
          <MenuItem icon={<LogOut className="size-4" />} onClick={() => signOut()}>
            Sign out
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
