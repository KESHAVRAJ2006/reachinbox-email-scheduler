import { Navigate, useSearchParams } from 'react-router';
import { CalendarClock, Gauge, Mail, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { googleLoginUrl } from '../lib/api';

// Codes the API (or our own logout) puts in ?error=...
const ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Google sign-in was cancelled.',
  invalid_state: 'That sign-in link expired. Please try again.',
  missing_code: 'Google did not complete the sign-in. Please try again.',
  missing_token: 'Sign-in did not complete. Please try again.',
  google_login_failed: 'Google sign-in failed. Please try again.',
  session_expired: 'Your session has expired. Please sign in again.',
};

const FEATURES = [
  { icon: CalendarClock, text: 'Schedule campaigns with BullMQ delayed jobs' },
  { icon: Gauge, text: 'Per-sender hourly limits across every worker' },
  { icon: ShieldCheck, text: 'Survives restarts and never sends twice' },
];

export default function LoginPage() {
  const { status } = useAuth();
  const [params] = useSearchParams();
  const error = params.get('error');

  if (status === 'ready') return <Navigate to="/" replace />;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left: brand panel (hidden on small screens) */}
      <div className="hidden flex-col justify-between bg-indigo-600 p-12 text-white lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Mail className="size-6" /> Email Scheduler
        </div>
        <div>
          <h2 className="text-3xl leading-tight font-semibold">Send at the right time.<br />Exactly once.</h2>
          <ul className="mt-8 space-y-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-indigo-100">
                <Icon className="size-5 shrink-0" /> {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-indigo-200">ReachInbox take-home assignment</p>
      </div>

      {/* Right: sign-in card */}
      <div className="flex items-center justify-center bg-slate-50 px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 text-lg font-semibold text-slate-900 lg:hidden">
            <Mail className="size-6 text-indigo-600" /> Email Scheduler
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to schedule and track your email campaigns.</p>

          {error && (
            <div role="alert" className="mt-6 flex gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200">
              <TriangleAlert className="size-4 shrink-0 translate-y-0.5" />
              {ERROR_MESSAGES[error] ?? 'Sign-in failed. Please try again.'}
            </div>
          )}

          {/* A plain link, not fetch(): the browser must actually navigate to Google. */}
          <a
            href={googleLoginUrl}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-300 transition hover:bg-slate-50"
          >
            <GoogleLogo />
            Continue with Google
          </a>
          <p className="mt-6 text-center text-xs text-slate-400">We only read your name, email and profile picture.</p>
        </div>
      </div>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg className="size-5" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
