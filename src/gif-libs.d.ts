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

declare module 'gifenc' {
  export function GIFEncoder(): {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      opts: { palette: number[][]; delay: number }
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number): number[][];
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][]
  ): Uint8Array;
}
