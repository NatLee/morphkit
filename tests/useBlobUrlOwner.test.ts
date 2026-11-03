import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBlobUrlOwner } from '../src/lib/useBlobUrlOwner';

// jsdom has no URL.revokeObjectURL; the hook only needs to call it
const revoke = vi.fn();
beforeEach(() => {
  revoke.mockReset();
  Object.assign(URL, { revokeObjectURL: revoke });
});

describe('useBlobUrlOwner', () => {
  it('revokes a URL only once it is no longer shown, and the rest on unmount', () => {
    const { rerender, unmount } = renderHook(({ urls }) => useBlobUrlOwner(urls), {
      initialProps: { urls: ['blob:a', 'blob:b'] as (string | undefined)[] },
    });
    expect(revoke).not.toHaveBeenCalled();

    rerender({ urls: ['blob:a', 'blob:c', undefined] }); // b replaced by c
    expect(revoke.mock.calls.map((c) => c[0])).toEqual(['blob:b']);

    rerender({ urls: ['blob:c', 'blob:a'] }); // same set, different order: nothing to do
    expect(revoke).toHaveBeenCalledTimes(1);

    unmount();
    expect(revoke.mock.calls.map((c) => c[0]).sort()).toEqual(['blob:a', 'blob:b', 'blob:c']);
  });

  it('leaves data: and http(s) URLs alone', () => {
    const { rerender, unmount } = renderHook(({ urls }) => useBlobUrlOwner(urls), {
      initialProps: { urls: ['data:image/png;base64,AA', 'https://example.com/a.png'] },
    });
    rerender({ urls: [] });
    unmount();
    expect(revoke).not.toHaveBeenCalled();
  });
});
