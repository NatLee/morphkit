import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { ColorPicker } from './ColorPicker';
import { classifyPayload, decodeFrame, decodeQr, DEFAULT_QR, payloads, qrToCanvas, qrToSvg, type QrStyle } from '../lib/qr';

type Tab = 'make' | 'read';
type Template = 'text' | 'url' | 'wifi' | 'vcard' | 'mail';

interface Props {
  /** open on the reader tab with this decoded text (from a FileCard QR chip) */
  initialDecoded?: string | null;
  /** push a generated PNG into the converter list */
  onAddImage: (file: File) => void;
  onClose: () => void;
}

/**
 * QR tool — two tabs. MAKE: templates (text / URL / Wi-Fi / vCard / mail) → live preview with
 * colours, size, quiet zone, ECC and an optional centre logo; download PNG/SVG, copy, or send the
 * PNG into the converter list. READ: drop/pick/paste an image (or scan with the camera) → decoded
 * payload with type-aware actions (open link, copy, "make a QR from this").
 */
export function QrTool({ initialDecoded, onAddImage, onClose }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(initialDecoded ? 'read' : 'make');
  // ---- make ----
  const [tpl, setTpl] = useState<Template>('url');
  const [text, setText] = useState('https://');
  const [wifi, setWifi] = useState({ ssid: '', pass: '', auth: 'WPA' as 'WPA' | 'WEP' | 'nopass', hidden: false });
  const [card, setCard] = useState({ name: '', org: '', tel: '', email: '', url: '' });
  const [mail, setMail] = useState({ to: '', subject: '', body: '' });
  const [st, setSt] = useState<QrStyle>(DEFAULT_QR);
  const [pngUrl, setPngUrl] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // ---- read ----
  const [decoded, setDecoded] = useState<string | null>(initialDecoded ?? null);
  const [readErr, setReadErr] = useState('');
  const [scanning, setScanning] = useState(false);
  const [camErr, setCamErr] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readRef = useRef<HTMLInputElement>(null);
  const [dropHot, setDropHot] = useState(false);

  const payload = (() => {
    switch (tpl) {
      case 'wifi': return wifi.ssid ? payloads.wifi(wifi.ssid, wifi.pass, wifi.auth, wifi.hidden) : '';
      case 'vcard': return card.name ? payloads.vcard(card) : '';
      case 'mail': return mail.to ? payloads.mail(mail.to, mail.subject, mail.body) : '';
      default: return text;
    }
  })();

  // live preview (debounced)
  useEffect(() => {
    if (tab !== 'make') return;
    const h = window.setTimeout(async () => {
      try {
        const c = await qrToCanvas(payload, { ...st, size: Math.min(st.size, 640) });
        canvasRef.current = c;
        setPngUrl(c.toDataURL('image/png'));
        setErr('');
      } catch {
        setErr(t('qrTooLong'));
      }
    }, 150);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, st, tab]);

  const exportPng = async (): Promise<Blob> => {
    const c = await qrToCanvas(payload, st);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/png'));
  };
  const fileName = () => `qr-${(tpl === 'url' ? text.replace(/^https?:\/\//, '').split(/[/?#]/)[0] : tpl).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 40) || 'code'}`;
  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  const copyPng = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': await exportPng() })]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  // ---- reader ----
  const readBlob = async (blob: Blob) => {
    setReadErr('');
    setDecoded(null);
    try {
      const hit = await decodeQr(blob);
      if (hit) setDecoded(hit.text);
      else setReadErr(t('qrNotFound'));
    } catch {
      setReadErr(t('qrNotFound'));
    }
  };
  const stopCam = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setScanning(false);
  };
  const startCam = async () => {
    setCamErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      requestAnimationFrame(() => {
        const v = videoRef.current;
        if (v) { v.srcObject = stream; void v.play(); }
      });
    } catch {
      setCamErr(t('qrCamDenied'));
    }
  };
  useEffect(() => {
    if (!scanning) return;
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (!alive) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2 && !busy) {
        busy = true;
        const r = await decodeFrame(v).catch(() => null);
        busy = false;
        if (r && alive) { setDecoded(r); stopCam(); return; }
      }
      window.setTimeout(tick, 250);
    };
    void tick();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);
  useEffect(() => () => stopCam(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // paste an image while the reader tab is open
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (tab !== 'read') return;
      for (const it of Array.from(e.clipboardData?.items ?? [])) {
        if (it.kind === 'file') { const f = it.getAsFile(); if (f) { e.preventDefault(); void readBlob(f); return; } }
      }
      const txt = e.clipboardData?.getData('text');
      if (txt) { e.preventDefault(); setDecoded(txt); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const kind = decoded ? classifyPayload(decoded) : 'text';
  const Field = ({ label, value, onChange, type = 'text', placeholder = '' }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) => (
    <label className="qr-field">
      <span className="sp-label">{label}</span>
      <input className="ed-input" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );

  const body = (
    // .qr-overlay: on phones this overlay sits BELOW the tab bar (z90 < z95) so the QR tab
    // itself toggles the tool closed — the top-right X was unreachable under browser chrome
    <div className="editor-overlay qr-overlay" onClick={onClose}>
      <div className="editor editor-wide qr-tool" role="dialog" aria-label={t('qrTitle')} onClick={(e) => e.stopPropagation()}>
        <div className="ed-head">
          <span className="ed-title">{t('qrTitle')}</span>
          <div className="ed-seg qr-tabs">
            <button className={tab === 'make' ? 'active' : ''} onClick={() => setTab('make')}>{t('qrMake')}</button>
            <button className={tab === 'read' ? 'active' : ''} onClick={() => setTab('read')}>{t('qrRead')}</button>
          </div>
          <button className="theme-toggle" onClick={onClose} aria-label={t('close')}>
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        {tab === 'make' ? (
          <div className="qr-make">
            <div className="qr-form">
              <div className="ed-seg qr-tpl">
                {(['url', 'text', 'wifi', 'vcard', 'mail'] as Template[]).map((k) => (
                  <button key={k} className={tpl === k ? 'active' : ''} onClick={() => setTpl(k)}>{t(`qrTpl_${k}`)}</button>
                ))}
              </div>
              {(tpl === 'url' || tpl === 'text') && (
                <label className="qr-field">
                  <span className="sp-label">{t(tpl === 'url' ? 'qrUrl' : 'qrText')}</span>
                  <textarea className="ed-input qr-text" rows={tpl === 'url' ? 2 : 4} value={text} onChange={(e) => setText(e.target.value)} placeholder={tpl === 'url' ? 'https://example.com' : ''} />
                </label>
              )}
              {tpl === 'wifi' && (
                <>
                  <Field label="SSID" value={wifi.ssid} onChange={(v) => setWifi({ ...wifi, ssid: v })} />
                  <Field label={t('qrWifiPass')} value={wifi.pass} onChange={(v) => setWifi({ ...wifi, pass: v })} />
                  <div className="qr-field">
                    <span className="sp-label">{t('qrWifiAuth')}</span>
                    <div className="ed-seg">
                      {(['WPA', 'WEP', 'nopass'] as const).map((a) => <button key={a} className={wifi.auth === a ? 'active' : ''} onClick={() => setWifi({ ...wifi, auth: a })}>{a === 'nopass' ? t('qrWifiOpen') : a}</button>)}
                    </div>
                  </div>
                  <label className="sp-field sp-check"><input type="checkbox" checked={wifi.hidden} onChange={(e) => setWifi({ ...wifi, hidden: e.target.checked })} /><span>{t('qrWifiHidden')}</span></label>
                </>
              )}
              {tpl === 'vcard' && (
                <>
                  <Field label={t('qrName')} value={card.name} onChange={(v) => setCard({ ...card, name: v })} />
                  <Field label={t('qrOrg')} value={card.org} onChange={(v) => setCard({ ...card, org: v })} />
                  <Field label={t('qrTel')} value={card.tel} onChange={(v) => setCard({ ...card, tel: v })} type="tel" />
                  <Field label="Email" value={card.email} onChange={(v) => setCard({ ...card, email: v })} type="email" />
                  <Field label="URL" value={card.url} onChange={(v) => setCard({ ...card, url: v })} />
                </>
              )}
              {tpl === 'mail' && (
                <>
                  <Field label={t('qrMailTo')} value={mail.to} onChange={(v) => setMail({ ...mail, to: v })} type="email" />
                  <Field label={t('qrMailSubject')} value={mail.subject} onChange={(v) => setMail({ ...mail, subject: v })} />
                  <label className="qr-field"><span className="sp-label">{t('qrMailBody')}</span><textarea className="ed-input qr-text" rows={3} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} /></label>
                </>
              )}

              <div className="qr-style">
                <label className="qr-field"><span className="sp-label">{t('qrSize')} <span className="sp-val">{st.size}px</span></span><input type="range" min={128} max={2048} step={64} value={st.size} onChange={(e) => setSt({ ...st, size: Number(e.target.value) })} /></label>
                <label className="qr-field"><span className="sp-label">{t('qrMargin')} <span className="sp-val">{st.margin}</span></span><input type="range" min={0} max={8} step={1} value={st.margin} onChange={(e) => setSt({ ...st, margin: Number(e.target.value) })} /></label>
                <div className="qr-field">
                  <span className="sp-label">{t('qrEcl')}</span>
                  <div className="ed-seg">{(['L', 'M', 'Q', 'H'] as const).map((l) => <button key={l} className={st.ecl === l ? 'active' : ''} onClick={() => setSt({ ...st, ecl: l })}>{l}</button>)}</div>
                </div>
                <div className="qr-field">
                  <span className="sp-label">{t('qrLogo')}</span>
                  <div className="pdf-wm-btns">
                    <button className="btn btn-ghost btn-sm" onClick={() => logoRef.current?.click()}>{st.logo ? t('pdfWmImageReplace') : t('pdfWmImagePick')}</button>
                    {st.logo && <button className="btn btn-ghost btn-sm" onClick={() => setSt({ ...st, logo: null })}>{t('pdfWmImageClear')}</button>}
                  </div>
                </div>
                <div className="qr-colors">
                  <div className="qr-field"><span className="sp-label">{t('qrFg')}</span><ColorPicker value={st.fg} onChange={(c) => setSt({ ...st, fg: c })} /></div>
                  <div className="qr-field">
                    <span className="sp-label">{t('qrBg')}</span>
                    <ColorPicker value={st.bg || '#ffffff'} onChange={(c) => setSt({ ...st, bg: c })} />
                    <label className="sp-field sp-check"><input type="checkbox" checked={!st.bg} onChange={(e) => setSt({ ...st, bg: e.target.checked ? '' : '#ffffff' })} /><span>{t('qrTransparent')}</span></label>
                  </div>
                </div>
              </div>
            </div>

            <div className="qr-preview">
              <div className={`qr-canvas${st.bg ? '' : ' checker'}`}>
                {pngUrl ? <img src={pngUrl} alt="" draggable={false} /> : <span className="spinner" />}
              </div>
              {err && <p className="pw-err">{err}</p>}
              <p className="ed-hint qr-payload" title={payload}>{payload.length} {t('qrChars')}</p>
              <div className="qr-actions">
                <button className="btn btn-accent" disabled={!payload || !!err} onClick={async () => download(await exportPng(), `${fileName()}.png`)}>PNG</button>
                <button className="btn btn-ghost" disabled={!payload || !!err} onClick={async () => download(new Blob([await qrToSvg(payload, st)], { type: 'image/svg+xml' }), `${fileName()}.svg`)}>SVG</button>
                <button className="btn btn-ghost" disabled={!payload || !!err} onClick={() => void copyPng()}>{copied ? t('copied') : t('copyResult')}</button>
                <button className="btn btn-ghost" disabled={!payload || !!err} onClick={async () => { onAddImage(new File([await exportPng()], `${fileName()}.png`, { type: 'image/png' })); onClose(); }}>{t('qrToList')}</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="qr-read">
            <div
              className={`qr-drop${dropHot ? ' drop-hot' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDropHot(true); }}
              onDragLeave={() => setDropHot(false)}
              onDrop={(e) => { e.preventDefault(); setDropHot(false); const f = e.dataTransfer.files[0]; if (f) void readBlob(f); }}
              onClick={() => readRef.current?.click()}
              role="button"
              tabIndex={0}
            >
              {scanning ? (
                <video ref={videoRef} className="qr-video" muted playsInline />
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM16 18h2v2h-2zM14 18h1M20 18v2h-1" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
                  <p>{t('qrDropHint')}</p>
                  <p className="ed-hint">{t('qrPasteHint')}</p>
                </>
              )}
            </div>
            <div className="qr-read-actions">
              {scanning ? (
                <button className="btn btn-ghost" onClick={stopCam}>{t('qrStopCam')}</button>
              ) : (
                <button className="btn btn-ghost" onClick={() => void startCam()}>{t('qrScanCam')}</button>
              )}
              <button className="btn btn-ghost" onClick={() => readRef.current?.click()}>{t('qrPickImage')}</button>
            </div>
            {camErr && <p className="pw-err">{camErr}</p>}
            {readErr && <p className="pw-err">{readErr}</p>}
            {decoded != null && (
              <div className="qr-result">
                <span className={`chip out qr-kind qr-kind-${kind}`}>{t(`qrKind_${kind}`)}</span>
                <textarea className="ed-input qr-decoded" readOnly value={decoded} rows={Math.min(8, Math.max(2, decoded.split('\n').length))} />
                <div className="qr-actions">
                  {kind === 'url' && <a className="btn btn-accent" href={decoded.trim()} target="_blank" rel="noreferrer noopener">{t('qrOpenLink')} ↗</a>}
                  <button className="btn btn-ghost" onClick={() => { void navigator.clipboard.writeText(decoded); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>{copied ? t('copied') : t('qrCopyText')}</button>
                  <button className="btn btn-ghost" onClick={() => { setTpl('text'); setText(decoded); setTab('make'); }}>{t('qrRemake')}</button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="ed-foot qr-foot">
          <span className="ed-hint" />
          <div className="ed-foot-main">
            <button className="btn btn-ghost" onClick={onClose}>{t('close')}</button>
          </div>
        </div>

        <input ref={logoRef} type="file" hidden accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) setSt({ ...st, logo: f, ecl: 'H' }); e.target.value = ''; }} />
        <input ref={readRef} type="file" hidden accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readBlob(f); e.target.value = ''; }} />
      </div>
    </div>
  );
  return createPortal(body, document.body);
}
