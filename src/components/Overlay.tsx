import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Full-viewport modal backdrop rendered via portal to <body>.
 * Portaling guarantees `position: fixed` is viewport-relative — ancestors with
 * transforms/filters can never trap or clip the overlay (invariant #17).
 */
export function Overlay({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return createPortal(
    <div className="editor-overlay" onClick={onClick}>{children}</div>,
    document.body
  );
}
