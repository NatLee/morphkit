import { useI18n } from '../i18n';

export function Hero({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();

  return (
    <section className={compact ? 'hero hero-compact' : 'hero'}>
      {/* tagline + title fold away (grid-rows collapse) once files are loaded */}
      <div className="hero-fold" aria-hidden={compact}>
        <div className="hero-fold-inner">
          <p className="hero-tagline">{t('tagline')}</p>
          <h1 className="hero-title">
            {t('heroA')}
            <span className="hero-accent" data-text={t('heroB')}>{t('heroB')}</span>
          </h1>
        </div>
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
        <span className="feat">
          <svg viewBox="0 0 24 24" width="13" height="13"><path d="M7 3h7l4 4v14H7zM14 3v4h4M10 13.5h4M10 16.5h4M10 10.5h1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {t('featPdf')}
        </span>
        <span className="feat">
          <svg viewBox="0 0 24 24" width="13" height="13"><path d="M4 6h16v13H4zM4 10.5h16M4 15h16M9.5 6v13M4 6l3-3h13v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {t('featDoc')}
        </span>
        <span className="feat">
          <svg viewBox="0 0 24 24" width="13" height="13"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3M20 14v3M14 20h3M20 20h.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {t('featQr')}
        </span>
      </div>
    </section>
  );
}
