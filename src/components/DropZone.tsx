import { useRef, useState, type DragEvent } from 'react';
import { useI18n } from '../i18n';

export function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    onFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
    >
      <div className="dz-glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </div>
      <p className="dz-title">{t('dropTitle')}</p>
      <p className="dz-hint">{t('dropHint')}</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept="image/*,audio/*,video/*"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
  );
}
