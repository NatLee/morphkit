import { useEffect, useRef, useState } from 'react';
import { Overlay } from './Overlay';
import { useI18n } from '../i18n';

interface Props {
  fileName: string;
  /** resolve true when the password opened the file; false → shake + retry */
  onSubmit: (password: string) => Promise<boolean>;
  onCancel: () => void;
}

/**
 * Password prompt for encrypted PDFs. The password is verified by the caller (pdf.js
 * open) before the modal closes; it lives only in memory afterwards — never persisted.
 */
export function PdfPasswordModal({ fileName, onSubmit, onCancel }: Props) {
  const { t } = useI18n();
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setWrong(false);
    const ok = await onSubmit(pw);
    setBusy(false);
    if (!ok) {
      setWrong(true);
      inputRef.current?.select();
    }
  };

  return (
    <Overlay onClick={onCancel}>
      <div
        className={`editor mini-modal pw-modal${wrong ? ' shake' : ''}`}
        role="dialog"
        aria-label={t('pdfPasswordTitle')}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={() => setWrong((w) => w)}
      >
        <p className="mx-label">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
          {' '}{t('pdfPasswordTitle')}
        </p>
        <p className="pw-file" title={fileName}>{fileName}</p>
        <div className="pw-row">
          <input
            ref={inputRef}
            className="ed-input pw-input"
            type={show ? 'text' : 'password'}
            value={pw}
            autoComplete="off"
            placeholder={t('pdfPasswordPlaceholder')}
            onChange={(e) => { setPw(e.target.value); setWrong(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') onCancel(); }}
          />
          <button className="btn btn-ghost btn-sm" onClick={() => setShow((s) => !s)} aria-label={t(show ? 'pdfPasswordHide' : 'pdfPasswordShow')}>
            {show ? (
              <svg viewBox="0 0 24 24" width="14" height="14"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M6.5 6.7C4.3 8.2 3 12 3 12s3.5 7 9 7c1.6 0 3-.4 4.3-1M9.9 5.2A9.6 9.6 0 0 1 12 5c5.5 0 9 7 9 7s-.7 1.4-2 2.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14"><path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
            )}
          </button>
        </div>
        {wrong ? (
          <p className="pw-err">{t('pdfPasswordWrong')}</p>
        ) : (
          <p className="ed-hint">{t('pdfPasswordHint')}</p>
        )}
        <div className="ed-foot">
          <span />
          <div className="ed-foot-main">
            <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>{t('cancel')}</button>
            <button className="btn btn-accent" onClick={() => void submit()} disabled={busy || !pw}>
              {busy ? t('processing') : t('pdfUnlock')}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
