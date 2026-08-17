import { useRef, type PointerEvent } from 'react';

interface Props {
  min: number;
  max: number;
  start: number;
  end: number;
  /** minimum gap between handles */
  gap?: number;
  onChange: (start: number, end: number) => void;
  format?: (v: number) => string;
}

/** Dual-handle range slider (trim timelines, frame ranges). */
export function DualRange({ min, max, start, end, gap = 0, onChange, format }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<'s' | 'e' | null>(null);

  const span = Math.max(max - min, 1e-9);
  const pct = (v: number) => ((v - min) / span) * 100;

  const valAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return min + r * span;
  };

  const move = (clientX: number) => {
    if (!dragRef.current) return;
    const v = valAt(clientX);
    if (dragRef.current === 's') onChange(Math.min(v, end - gap), end);
    else onChange(start, Math.max(v, start + gap));
  };

  const down = (which: 's' | 'e') => (e: PointerEvent<HTMLDivElement>) => {
    dragRef.current = which;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const trackDown = (e: PointerEvent<HTMLDivElement>) => {
    // clicking the track grabs the nearest handle
    const v = valAt(e.clientX);
    dragRef.current = Math.abs(v - start) <= Math.abs(v - end) ? 's' : 'e';
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    move(e.clientX);
  };

  return (
    <div className="dual">
      <div
        ref={trackRef}
        className="dual-track"
        onPointerDown={trackDown}
        onPointerMove={(e) => move(e.clientX)}
        onPointerUp={() => { dragRef.current = null; }}
      >
        <div
          className="dual-fill"
          style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }}
        />
        <div className="dual-handle" style={{ left: `${pct(start)}%` }} onPointerDown={down('s')} />
        <div className="dual-handle" style={{ left: `${pct(end)}%` }} onPointerDown={down('e')} />
      </div>
      {format && (
        <div className="dual-labels">
          <span>{format(start)}</span>
          <span>{format(end)}</span>
        </div>
      )}
    </div>
  );
}
