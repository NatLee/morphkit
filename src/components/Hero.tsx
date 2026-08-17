import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { outputsFor, type Kind } from '../lib/formats';

export const FORMAT_GROUPS: { kind: Kind; labelKey: string; formats: string[] }[] = [
  { kind: 'image', labelKey: 'kindImage', formats: ['png', 'jpg', 'webp', 'bmp', 'gif', 'apng', 'avif'] },
  { kind: 'audio', labelKey: 'kindAudio', formats: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'] },
  { kind: 'video', labelKey: 'kindVideo', formats: ['mp4', 'webm', 'mov', 'avi', 'mkv'] },
];

const DEMO: [string, string][] = [
  ['png', 'webp'],
  ['mp4', 'gif'],
  ['flac', 'mp3'],
  ['mov', 'mp4'],
  ['jpg', 'png'],
  ['wav', 'ogg'],
];

function kindOf(fmt: string): Kind {
  return FORMAT_GROUPS.find((g) => g.formats.includes(fmt))?.kind ?? 'image';
}

function defaultOut(fmt: string): string {
  const outs = outputsFor(kindOf(fmt));
  const norm = fmt === 'jpg' ? 'jpeg' : fmt;
  return outs.find((o) => o !== norm) ?? outs[0];
}

function fmtLabel(f: string): string {
  return (f === 'jpeg' ? 'jpg' : f).toUpperCase();
}

interface Props {
  onFiles: (files: File[], preset?: { kind: Kind; target: string }) => void;
}

export function Hero({ onFiles }: Props) {
  const { t } = useI18n();
  const [from, setFrom] = useState('png');
  const [to, setTo] = useState('webp');
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // idle demo: cycle through popular conversions until the user interacts
  useEffect(() => {
    if (touched) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % DEMO.length;
      setFrom(DEMO[i][0]);
      setTo(DEMO[i][1]);
    }, 2600);
    return () => clearInterval(id);
  }, [touched]);

  const kind = kindOf(from);
  const outs = outputsFor(kind);

  const pickFrom = (v: string) => {
    setTouched(true);
    setFrom(v);
    setTo(defaultOut(v));
  };

  const pickTo = (v: string) => {
    setTouched(true);
    setTo(v);
  };

  return (
    <section className="hero">
      <p className="hero-tagline">{t('tagline')}</p>
      <h1 className="hero-title">
        {t('heroA')}
        <span className="hero-accent">{t('heroB')}</span>
      </h1>

      <div className="hero-stage">
        <div className="format-card from">
          <svg viewBox="0 0 24 24" className="format-icon" aria-hidden="true">
            <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="currentColor" opacity=".18" />
            <path d="M15 2v5h5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <div className="fsel" key={touched ? 'from' : `from-${from}`}>
            <select
              value={from}
              onChange={(e) => pickFrom(e.target.value)}
              onFocus={() => setTouched(true)}
              aria-label="Source format"
            >
              {FORMAT_GROUPS.map((g) => (
                <optgroup key={g.kind} label={t(g.labelKey)}>
                  {g.formats.map((f) => (
                    <option key={f} value={f}>{fmtLabel(f)}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        <div className="stage-link" aria-hidden="true">
          <span className="stage-line" />
          <div className="stage-orb">
            <svg viewBox="0 0 24 24" className="orb-icon">
              <path d="M4 9a8 8 0 0 1 14.9-2M20 15a8 8 0 0 1-14.9 2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M18 3v4h-4M6 21v-4h4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="stage-to">TO</span>
          <span className="stage-line" />
        </div>

        <div className="format-card to">
          <svg viewBox="0 0 24 24" className="format-icon" aria-hidden="true">
            <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="currentColor" opacity=".25" />
            <path d="M15 2v5h5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <div className="fsel accent" key={touched ? 'to' : `to-${to}`}>
            <select
              value={to}
              onChange={(e) => pickTo(e.target.value)}
              onFocus={() => setTouched(true)}
              aria-label="Target format"
            >
              {outs.map((o) => (
                <option key={o} value={o}>{fmtLabel(o)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="hero-cta">
        <button className="btn btn-accent btn-lg" onClick={() => inputRef.current?.click()}>
          {t('chooseFiles')}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={`${kind}/*`}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) onFiles(files, { kind, target: to });
            e.target.value = '';
          }}
        />
      </div>

      <div className="feat-row">
        <span className="feat">
          <svg viewBox="0 0 24 24" width="13" height="13"><path d="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.5 7.5L20 19M8.5 16.5L20 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          {t('featTrim')}
        </span>
        <span className="feat">
          <svg viewBox="0 0 24 24" width="13" height="13"><path d="M4 20l1-4L16 5l3 3L8 19l-4 1zM14.5 6.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {t('featPaint')}
        </span>
        <span className="feat">
          <svg viewBox="0 0 24 24" width="13" height="13"><path d="M4 5h16v14H4zM4 9h16M8 5v14M16 5v14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {t('featGif')}
        </span>
      </div>
    </section>
  );
}
