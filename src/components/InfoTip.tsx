import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Small ⓘ icon with a tooltip.
 * The tooltip renders in a portal at a fixed position, so it is never
 * clipped by overflow containers (timeline scroller, asset panel…).
 */
export function InfoTip({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      x: Math.min(Math.max(r.left + r.width / 2, 132), window.innerWidth - 132),
      y: r.top - 8,
    });
  };

  const hide = () => setPos(null);

  return (
    <span
      ref={ref}
      className="info-i"
      tabIndex={0}
      role="note"
      aria-label={text}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <svg viewBox="0 0 24 24" width="12" height="12">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 11v5M12 7.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {pos &&
        createPortal(
          <span className="tip-pop" style={{ left: pos.x, top: pos.y }}>{text}</span>,
          document.body
        )}
    </span>
  );
}
