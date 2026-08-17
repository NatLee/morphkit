/** Small ⓘ icon with a hover/focus tooltip explaining a feature. */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="info-i" data-tip={text} tabIndex={0} role="note" aria-label={text}>
      <svg viewBox="0 0 24 24" width="12" height="12">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 11v5M12 7.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}
