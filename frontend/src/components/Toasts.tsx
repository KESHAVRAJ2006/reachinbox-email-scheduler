import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';
type Toast = { id: number; kind: ToastKind; title: string; message?: string };
type ToastApi = Record<ToastKind, (title: string, message?: string) => void>;

const ToastContext = createContext<ToastApi | null>(null);
const DISMISS_AFTER_MS = 5_000;

const STYLES: Record<ToastKind, { icon: ReactNode; ring: string }> = {
  success: { icon: <CheckCircle2 className="size-5 text-emerald-600" />, ring: 'ring-emerald-200' },
  error: { icon: <TriangleAlert className="size-5 text-rose-600" />, ring: 'ring-rose-200' },
  info: { icon: <Info className="size-5 text-indigo-600" />, ring: 'ring-indigo-200' },
};

// Holds the list of visible toasts; any component can call toast.success(...) etc.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (kind: ToastKind, title: string, message?: string) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { id, kind, title, message }]); // at most 4 on screen
      setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
    },
    [dismiss],
  );

  // useMemo keeps the same object between renders, so components using it don't re-render needlessly.
  const api = useMemo<ToastApi>(
    () => ({
      success: (title, message) => push('success', title, message),
      error: (title, message) => push('error', title, message),
      info: (title, message) => push('info', title, message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* aria-live: screen readers announce new toasts without moving focus */}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 rounded-xl bg-white p-4 shadow-lg ring-1 ${STYLES[toast.kind].ring} animate-[toast-in_150ms_ease-out]`}
          >
            {STYLES[toast.kind].icon}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
              {toast.message && <p className="mt-0.5 text-sm text-slate-600">{toast.message}</p>}
            </div>
            <button onClick={() => dismiss(toast.id)} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}
