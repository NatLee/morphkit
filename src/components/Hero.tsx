import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

const PAIRS: [string, string][] = [
  ['PNG', 'WEBP'],
  ['MP4', 'GIF'],
  ['FLAC', 'MP3'],
  ['MOV', 'MP4'],
  ['JPG', 'PNG'],
  ['WAV', 'OGG'],
];

export function Hero() {
  const { t } = useI18n();
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % PAIRS.length), 2400);
    return () => clearInterval(id);
  }, []);

  const [from, to] = PAIRS[idx];

  return (
    <section className="hero">
      <div className="radar" aria-hidden="true">
        <div className="radar-rings" />
        <div className="radar-sweep" />
      </div>

      <p className="hero-tagline">{t('tagline')}</p>
      <h1 className="hero-title">
        {t('heroA')}
        <span className="hero-accent">{t('heroB')}</span>
      </h1>
      <p className="hero-sub">{t('heroSub')}</p>

      <div className="hero-stage" aria-hidden="true">
        <div className="format-card from" key={`f-${idx}`}>
          <svg viewBox="0 0 24 24" className="format-icon">
            <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="currentColor" opacity=".18" />
            <path d="M15 2v5h5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <span className="format-name">{from}</span>
        </div>

        <div className="stage-link">
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

        <div className="format-card to" key={`t-${idx}`}>
          <svg viewBox="0 0 24 24" className="format-icon">
            <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="currentColor" opacity=".25" />
            <path d="M15 2v5h5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <span className="format-name">{to}</span>
        </div>
      </div>

      <div className="privacy-badge">
        <span className="privacy-dot" />
        {t('privacy')}
      </div>
    </section>
  );
}
