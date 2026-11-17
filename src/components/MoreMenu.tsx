import { useEffect, useRef, useState } from 'react';

export interface MoreMenuItem {
  key: string;
  label: string;
  /** one line under the label: what it does */
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * The "⋯" button and its menu, for actions used less often than the ones on the row itself
 * (file cards, project cards). Closes on a pick, a click elsewhere and Escape.
 */
export function MoreMenu({ label, items }: { label: string; items: readonly MoreMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="fc-more" ref={ref}>
      <button
        type="button"
        className={`btn btn-ghost fc-remove${open ? ' active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="5" cy="12" r="1.7" fill="currentColor" /><circle cx="12" cy="12" r="1.7" fill="currentColor" /><circle cx="19" cy="12" r="1.7" fill="currentColor" /></svg>
      </button>
      {open && (
        <div className="fc-menu" role="menu">
          {items.map((it) => (
            <button key={it.key} type="button" role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.onSelect(); }}>
              <b>{it.label}</b>
              {it.hint && <span>{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
