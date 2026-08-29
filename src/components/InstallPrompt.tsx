import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

/** Chrome's install event (not yet in lib.dom) */
type BipEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'morphkit-install-dismissed';
const DISMISS_DAYS = 14;

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

const recentlyDismissed = () => {
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - ts < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
};

/**
 * "Add to Home Screen" card. Android/desktop Chrome: captures
 * `beforeinstallprompt` and offers a real install button. iOS Safari never
 * fires it, so we show the Share → Add-to-Home-Screen hint instead.
 * Hidden while running installed (standalone) or for 14 days after dismissal.
 */
export function InstallPrompt() {
  const { t } = useI18n();
  const [bip, setBip] = useState<BipEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;
    const onBip = (e: Event) => {
      e.preventDefault();
      setBip(e as BipEvent);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    const ua = navigator.userAgent;
    // iPadOS 13+ reports as Macintosh — the touch probe tells them apart
    const isIos = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    if (isIos) setIosHint(true);
    return () => window.removeEventListener('beforeinstallprompt', onBip);
  }, []);

  const close = () => {
    setHidden(true);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
  };

  const install = async () => {
    if (!bip) return;
    await bip.prompt();
    const { outcome } = await bip.userChoice;
    setBip(null);
    if (outcome === 'accepted') setHidden(true);
    else close();
  };

  if (hidden || (!bip && !iosHint)) return null;

  return (
    <div className="install-card" role="dialog" aria-label={t('installTitle')}>
      <span className="install-icon" aria-hidden="true">
        <svg viewBox="0 0 32 32">
          <defs>
            <linearGradient id="ip-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--accent)" />
              <stop offset="1" stopColor="var(--paint-red)" />
            </linearGradient>
          </defs>
          <path d="M6 1h20l5 5v20l-5 5H6l-5-5V6z" fill="var(--mark-bg)" />
          <path d="M10 21V11l6 6 6-6v10" stroke="url(#ip-g)" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="install-text">
        <strong>{t('installTitle')}</strong>
        <span>{bip ? t('installBody') : t('installIosHint')}</span>
      </div>
      <div className="install-btns">
        {bip && (
          <button className="btn btn-accent btn-sm" onClick={() => void install()}>
            {t('installBtn')}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={close}>
          {t('installLater')}
        </button>
      </div>
    </div>
  );
}
