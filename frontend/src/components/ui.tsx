import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { EmailStatus } from '../lib/types';

// Small shared building blocks, so every screen looks consistent.

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
};

const VARIANTS = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:outline-indigo-600 shadow-sm',
  secondary: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 shadow-sm',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'text-rose-600 hover:bg-rose-50',
};

export function Button({ variant = 'primary', loading = false, disabled, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
      <Loader2 className="size-5 animate-spin" />
      {label}
    </div>
  );
}

const STATUS_STYLES: Record<EmailStatus, { label: string; className: string }> = {
  scheduled: { label: 'Scheduled', className: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20' },
  sending: { label: 'Sending', className: 'bg-amber-50 text-amber-700 ring-amber-600/20 animate-pulse' },
  sent: { label: 'Sent', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  failed: { label: 'Failed', className: 'bg-rose-50 text-rose-700 ring-rose-600/20' },
};

export function StatusBadge({ status, title }: { status: EmailStatus; title?: string }) {
  const style = STATUS_STYLES[status];
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style.className}`}>
      {style.label}
    </span>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 rounded-full bg-slate-100 p-3 text-slate-500">{icon}</div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// Grey placeholder bars shown while the first page of data loads.
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-slate-100" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-4 px-5 py-4">
          <div className="h-3.5 w-48 rounded bg-slate-200" />
          <div className="h-3.5 flex-1 rounded bg-slate-100" />
          <div className="h-3.5 w-24 rounded bg-slate-200" />
          <div className="h-5 w-16 rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  );
}
