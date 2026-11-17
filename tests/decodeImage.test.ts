import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeImage } from '../src/lib/decodeImage';

// Regression: .svg is an accepted image, but createImageBitmap (the only decoder the app used)
// refuses SVG in Chrome and Edge, so every SVG conversion failed with "Conversion failed".
const bitmap = { width: 120, height: 80, close() {} };
const realCreate = globalThis.createImageBitmap;
// jsdom has no HTMLImageElement.decode (every browser the app supports does): give it one per test
const proto = HTMLImageElement.prototype as unknown as { decode?: () => Promise<void> };
const setDecode = (fn: () => Promise<void>) => { proto.decode = fn; };
afterEach(() => {
  globalThis.createImageBitmap = realCreate;
  delete proto.decode;
  vi.restoreAllMocks();
});

describe('decodeImage', () => {
  it('uses the fast decoder when it can', async () => {
    globalThis.createImageBitmap = vi.fn(async () => bitmap) as never;
    const blob = new Blob(['png'], { type: 'image/png' });
    expect(await decodeImage(blob)).toBe(bitmap);
    expect(globalThis.createImageBitmap).toHaveBeenCalledWith(blob);
  });

  it('falls back to an <img> for what the fast decoder refuses (SVG), at the size the image lays out', async () => {
    const create = vi.fn(async (src: unknown) => {
      if (src instanceof Blob) throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
      return bitmap;
    });
    globalThis.createImageBitmap = create as never;
    URL.createObjectURL = vi.fn(() => 'blob:svg');
    URL.revokeObjectURL = vi.fn();
    setDecode(vi.fn(async () => {}));
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(120);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(80);
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"/>'], { type: 'image/svg+xml' });
    expect(await decodeImage(svg)).toBe(bitmap);
    const [img, opts] = create.mock.calls[1] as unknown as [HTMLImageElement, ImageBitmapOptions];
    expect(img).toBeInstanceOf(HTMLImageElement);
    expect(img.src).toBe('blob:svg');
    expect(opts).toEqual({ resizeWidth: 120, resizeHeight: 80 });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:svg');
  });

  it('still fails, with the first error, on a file neither way can read', async () => {
    const refused = new DOMException('The source image could not be decoded.', 'InvalidStateError');
    globalThis.createImageBitmap = vi.fn(async () => { throw refused; }) as never;
    URL.createObjectURL = vi.fn(() => 'blob:bad');
    URL.revokeObjectURL = vi.fn();
    setDecode(vi.fn(async () => { throw new Error('EncodingError'); }));
    await expect(decodeImage(new Blob(['not an image']))).rejects.toBe(refused);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:bad');
  });
});
