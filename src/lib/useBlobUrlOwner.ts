import { useEffect, useRef } from 'react';

const isBlobUrl = (u: string | null | undefined): u is string => !!u && u.startsWith('blob:');

/**
 * Owns the lifetime of the blob: URLs a component keeps in its state. Pass every URL the current
 * render shows; after React commits, URLs from earlier renders that are gone are revoked, and the
 * rest are revoked on unmount. Callers create a URL, put it in state, and simply drop it from
 * state when it is replaced or removed — no revoke-before-every-patch bookkeeping, and nothing is
 * revoked while a mounted <img>/<a> may still point at it. Non-blob URLs (data:, http) are ignored.
 */
export function useBlobUrlOwner(urls: Iterable<string | null | undefined>): void {
  const owned = useRef<Set<string>>(new Set());
  // a stable string key, so the effect only runs when the set of URLs actually changes
  const key = [...new Set([...urls].filter(isBlobUrl))].sort().join('\n');

  useEffect(() => {
    const now = new Set(key ? key.split('\n') : []);
    for (const u of owned.current) if (!now.has(u)) URL.revokeObjectURL(u);
    owned.current = now;
  }, [key]);

  useEffect(() => () => {
    for (const u of owned.current) URL.revokeObjectURL(u);
    owned.current = new Set();
  }, []);
}
