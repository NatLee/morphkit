import { extOf } from './formats';

/**
 * HEIC / HEIF photos (what iPhones save). Chrome and Edge cannot decode them, so libheif — compiled to
 * wasm, LGPL-3.0, its own ~1.5 MB file — is loaded the first time such a photo is opened, and never
 * before. It hands back the photo's pixels; everything after that is the usual image path.
 */
interface HeifImage {
  get_width(): number;
  get_height(): number;
  is_primary?(): boolean;
  display(target: ImageData, done: (result: ImageData | null) => void): void;
  free?(): void;
}
interface Libheif { HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] } }

let lib: Promise<Libheif> | null = null;
function loadLibheif(): Promise<Libheif> {
  if (!lib) {
    lib = Promise.all([
      import('libheif-js/libheif-wasm/libheif.js'),
      import('libheif-js/libheif-wasm/libheif.wasm?url'),
    ])
      // this build instantiates synchronously, so it must be handed the wasm bytes (it would otherwise try a
      // synchronous download, which browsers refuse outside workers) — the same thing its bundled variant does
      .then(async ([m, w]) => {
        const res = await fetch(w.default);
        if (!res.ok) throw new Error(`libheif: ${res.status}`);
        const wasmBinary = new Uint8Array(await res.arrayBuffer());
        return (m.default as unknown as (opts: object) => Libheif | Promise<Libheif>)({ wasmBinary });
      })
      .catch((e) => { lib = null; throw e; });
  }
  return lib;
}

const HEIF_EXT: ReadonlySet<string> = new Set(['heic', 'heif']);
const HEIF_MIME: ReadonlySet<string> = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
/** Major brands (bytes 8–12 of the `ftyp` box) of HEIF stills and sequences. AVIF says `avif` and is not one of them. */
const HEIF_BRANDS: ReadonlySet<string> = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'heif']);

/** Is this a HEIF/HEIC photo? By its type or name, else by the file's own `ftyp` header (a pasted photo has neither). */
export async function isHeif(blob: Blob): Promise<boolean> {
  const name = (blob as File).name ?? '';
  if (HEIF_MIME.has(blob.type) || HEIF_EXT.has(extOf(name))) return true;
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const text = String.fromCharCode(...head);
  return text.slice(4, 8) === 'ftyp' && HEIF_BRANDS.has(text.slice(8, 12));
}

/** The main picture of a HEIF file as pixels (a burst or a live photo holds several; the primary one is the photo). */
export async function heifPixels(blob: Blob): Promise<ImageData> {
  const { HeifDecoder } = await loadLibheif();
  const images = new HeifDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
  try {
    const img = images.find((i) => i.is_primary?.()) ?? images[0];
    if (!img) throw new Error('heif: no image in the file');
    const pixels = new ImageData(img.get_width(), img.get_height());
    await new Promise<void>((resolve, reject) => img.display(pixels, (out) => (out ? resolve() : reject(new Error('heif: could not decode')))));
    return pixels;
  } finally {
    for (const i of images) i.free?.();
  }
}
