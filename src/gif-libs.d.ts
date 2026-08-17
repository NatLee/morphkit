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
