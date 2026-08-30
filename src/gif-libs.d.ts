declare module 'gifuct-js' {
  export interface GifFrame {
    dims: { top: number; left: number; width: number; height: number };
    delay: number;
    disposalType: number;
    patch: Uint8ClampedArray;
  }
  export function parseGIF(buf: ArrayBuffer): { lsd: { width: number; height: number } };
  export function decompressFrames(gif: unknown, buildPatch: boolean): GifFrame[];
}

declare module 'upng-js' {
  interface UPNGImage {
    width: number;
    height: number;
    frames: { delay: number }[];
  }
  const UPNG: {
    decode(buf: ArrayBuffer): UPNGImage;
    toRGBA8(img: UPNGImage): ArrayBuffer[];
    encode(imgs: ArrayBuffer[], w: number, h: number, cnum: number, dels?: number[]): ArrayBuffer;
  };
  export default UPNG;
}

declare module 'gifenc' {
  export function GIFEncoder(): {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      opts: {
        palette: number[][];
        delay: number;
        transparent?: boolean;
        transparentIndex?: number;
        dispose?: number;
      }
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: string }
  ): number[][];
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: string
  ): Uint8Array;
}

declare module '@jspawn/qpdf-wasm/qpdf.js' {
  /** Emscripten MODULARIZE factory (qpdf CLI). */
  const createQpdf: (opts?: Record<string, unknown>) => Promise<unknown>;
  export default createQpdf;
}

declare module 'mammoth/mammoth.browser.js' {
  /** UMD bundle of mammoth (node-free); same API as the `mammoth` typings. */
  import type * as Mammoth from 'mammoth';
  const m: typeof Mammoth & { default?: typeof Mammoth };
  export = m;
}

declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
}
