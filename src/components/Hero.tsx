import { useI18n } from '../i18n';

export function Hero() {
  const { t } = useI18n();

  return (
    <section className="hero">
      <p className="hero-tagline">{t('tagline')}</p>
      <h1 className="hero-title">
        {t('heroA')}
        <span className="hero-accent">{t('heroB')}</span>
      </h1>

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
