import { useEffect, useRef, useState, type PointerEvent } from 'react';

/** Inline HSV picker: hue strip + saturation/value square + hex field. */

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const x = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(x * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max ? d / max : 0, v: max };
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value) ?? { h: 20, s: 0.8, v: 0.8 });
  const [hexText, setHexText] = useState(value);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<'sv' | 'hue' | null>(null);
  const selfRef = useRef(false);

  // external changes (swatches, other tools) drive the picker
  useEffect(() => {
    if (selfRef.current) { selfRef.current = false; return; }
    const next = hexToHsv(value);
    if (next) setHsv(next);
    setHexText(value);
  }, [value]);

  const emit = (h: number, s: number, v: number) => {
    const hex = hsvToHex(h, s, v);
    selfRef.current = true;
    setHexText(hex);
    onChange(hex);
  };

  const pickSV = (e: PointerEvent) => {
    const r = svRef.current?.getBoundingClientRect();
    if (!r) return;
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setHsv((p) => ({ ...p, s, v }));
    emit(hsv.h, s, v);
  };

  const pickHue = (e: PointerEvent) => {
    const r = hueRef.current?.getBoundingClientRect();
    if (!r) return;
    const h = Math.min(360, Math.max(0, ((e.clientX - r.left) / r.width) * 360));
    setHsv((p) => ({ ...p, h }));
    emit(h, hsv.s, hsv.v);
  };

  return (
    <div className="cp">
      <div
        ref={svRef}
        className="cp-sv"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex(hsv.h, 1, 1)})` }}
        onPointerDown={(e) => {
          dragRef.current = 'sv';
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          pickSV(e);
        }}
        onPointerMove={(e) => { if (dragRef.current === 'sv') pickSV(e); }}
        onPointerUp={() => { dragRef.current = null; }}
      >
        <span
          className="cp-dot"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
        />
      </div>

      <div
        ref={hueRef}
        className="cp-hue"
        onPointerDown={(e) => {
          dragRef.current = 'hue';
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          pickHue(e);
        }}
        onPointerMove={(e) => { if (dragRef.current === 'hue') pickHue(e); }}
        onPointerUp={() => { dragRef.current = null; }}
      >
        <span className="cp-hue-dot" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>

      <div className="cp-foot">
        <span className="cp-preview" style={{ background: value }} />
        <input
          className="cp-hex"
          value={hexText}
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value;
            setHexText(v);
            const parsed = hexToHsv(v);
            if (parsed) {
              setHsv(parsed);
              selfRef.current = true;
              onChange(v.startsWith('#') ? v : `#${v}`);
            }
          }}
        />
      </div>
    </div>
  );
}
