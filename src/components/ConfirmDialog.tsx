import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Overlay } from './Overlay';
import { useI18n } from '../i18n';

interface Props {
  title: string;
  /** what will be lost — name the thing and what goes with it */
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Second step for actions that cannot be undone (deleting a Studio project or asset).
 * Cancel holds the focus, so Enter or a stray click on the backdrop never deletes;
 * Escape cancels. Keys stop here so editor shortcuts underneath don't fire.
 */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  const { t } = useI18n();
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);

  return (
    <Overlay onClick={onCancel}>
      <div
        className="editor mini-modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <p className="mx-label" id={titleId}>{title}</p>
        <p className="confirm-msg">{message}</p>
        <div className="ed-foot-main">
          <button ref={cancelRef} className="btn btn-ghost" onClick={onCancel}>{t('cancel')}</button>
          <button className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </Overlay>
  );
}
