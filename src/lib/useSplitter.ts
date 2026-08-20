import { useRef, useState, type PointerEvent } from 'react';

export interface SplitterOpts {
  /** panel sits after the gutter (right/bottom): dragging toward it grows the size */
  invert?: boolean;
  /** 'x' tracks clientX (col-resize), 'y' tracks clientY (row-resize) */
  axis?: 'x' | 'y';
}

/**
 * Draggable panel-size state, persisted to localStorage. Spread `gutterProps`
 * onto a splitter element (needs CSS touch-action:none): pointer-drag resizes,
 * double-click resets to the default. Same behaviour as ImageEditor's original
 * .ie-gutter logic, generalised for every editor layout.
 */
export function useSplitter(
  key: string,
  def: number,
  min: number,
  max: number,
  opts: SplitterOpts = {}
): { size: number; gutterProps: Record<string, unknown> } {
  const { invert = false, axis = 'x' } = opts;
  const [size, setSize] = useState(() => {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v >= min && v <= max ? v : def;
  });
  const dragRef = useRef<{ p0: number; s0: number; last: number } | null>(null);

  const save = (v: number) => {
    try { localStorage.setItem(key, String(v)); } catch { /* private mode */ }
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { p0: axis === 'x' ? e.clientX : e.clientY, s0: size, last: size };
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const p = axis === 'x' ? e.clientX : e.clientY;
    const delta = invert ? d.p0 - p : p - d.p0;
    const v = Math.max(min, Math.min(max, d.s0 + delta));
    d.last = v;
    setSize(v);
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    save(d.last);
  };

  const onDoubleClick = () => {
    setSize(def);
    save(def);
  };

  return {
    size,
    gutterProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onDoubleClick },
  };
}
