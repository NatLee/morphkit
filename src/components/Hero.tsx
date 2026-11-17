import { useI18n } from '../i18n';

/** Home page headline. Folds away once files are in the list — the work takes the space. */
export function Hero({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();

  return (
    <section className={compact ? 'hero hero-compact' : 'hero'}>
      <div className="hero-fold" aria-hidden={compact}>
        <div className="hero-fold-inner">
          <p className="hero-tagline">{t('tagline')}</p>
          <h1 className="hero-title">
            {t('heroA')}
            <span className="hero-accent" data-text={t('heroB')}>{t('heroB')}</span>
          </h1>
        </div>
      </div>
    </section>
  );
}
