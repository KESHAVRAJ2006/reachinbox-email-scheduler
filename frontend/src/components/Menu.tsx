import { useEffect, useRef, useState, type ReactNode } from 'react';

// A button that opens a small dropdown panel. Closes on outside click or Escape.
export function Menu({ trigger, label, children }: { trigger: ReactNode; label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    // Cleanup removes the listeners when the menu closes or the component unmounts.
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="rounded-lg focus-visible:outline-2 focus-visible:outline-indigo-600">
        {trigger}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-slate-200">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, icon, children, danger = false }: { onClick: () => void; icon?: ReactNode; children: ReactNode; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm hover:bg-slate-50 ${danger ? 'text-rose-600' : 'text-slate-700'}`}
    >
      {icon}
      {children}
    </button>
  );
}
