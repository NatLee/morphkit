import { useI18n } from '../i18n';

const MATRIX = [
  {
    key: 'kindImage',
    icon: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm2 10 3.5-4.5 2.5 3 2-2.5L18 15H6zm2.5-7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
    ins: ['PNG', 'JPG', 'WEBP', 'BMP', 'GIF', 'AVIF'],
    outs: ['WEBP', 'PNG', 'JPG'],
  },
  {
    key: 'kindAudio',
    icon: 'M9 18a3 3 0 1 1-2-2.83V6l11-2v10a3 3 0 1 1-2-2.83V7.4l-7 1.27V18z',
    ins: ['MP3', 'WAV', 'OGG', 'FLAC', 'M4A', 'AAC', 'OPUS'],
    outs: ['MP3', 'WAV', 'OGG', 'FLAC', 'M4A'],
  },
  {
    key: 'kindVideo',
    icon: 'M4 6h11a1 1 0 0 1 1 1v2.5l4-2.5a.6.6 0 0 1 1 .5v9a.6.6 0 0 1-1 .5l-4-2.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
    ins: ['MP4', 'WEBM', 'MOV', 'AVI', 'MKV'],
    outs: ['MP4', 'WEBM', 'GIF', 'MP3'],
  },
];

export function FormatMatrix() {
  const { t } = useI18n();
  return (
    <section className="matrix">
      <h2 className="matrix-title">{t('supported')}</h2>
      <div className="matrix-grid">
        {MATRIX.map((m) => (
          <div className="mx-card" key={m.key}>
            <div className="mx-head">
              <span className="mx-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d={m.icon} fill="currentColor" /></svg>
              </span>
              <span className="mx-kind">{t(m.key)}</span>
            </div>
            <p className="mx-label">{t('inLabel')}</p>
            <div className="mx-chips">
              {m.ins.map((f) => <span className="chip" key={f}>{f}</span>)}
            </div>
            <div className="mx-arrow" aria-hidden="true">↓</div>
            <p className="mx-label">{t('outLabel')}</p>
            <div className="mx-chips">
              {m.outs.map((f) => <span className="chip out" key={f}>{f}</span>)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
