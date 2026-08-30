/**
 * On-demand CJK fonts for SELECTABLE-text PDF export.
 * Google Fonts splits Noto Sans TC/JP/KR into ~100 woff2 subsets per weight, each declaring its
 * `unicode-range`. We fetch the css2 stylesheet, keep only the subsets that intersect the
 * document's codepoints, download those woff2 files (30–130 KB each; fonts.gstatic.com is in the
 * service-worker allowlist so they cache for offline reuse), and pdf-lib embeds each one
 * subsetted again. Latin comes from the same families, so metrics stay consistent.
 */

interface FontBlock {
  /** stable id: `${family}:${weight}:${n}` */
  key: string;
  weight: 400 | 700;
  /** family priority (lower wins when several cover a codepoint) */
  prio: number;
  ranges: [number, number][];
  url: string;
}

export interface FontSeg { text: string; key: string }

export interface CjkFontSet {
  /** font bytes per block key (only the blocks the document needs) */
  bytes: Map<string, Uint8Array>;
  /** split a string into same-font segments; unknown codepoints are replaced with '?' */
  segment(text: string, bold: boolean): FontSeg[];
}

const kana = /[぀-ヿ㇀-㇯]/;
const hangul = /[가-힯ᄀ-ᇿㄱ-ㆎ]/;

function familiesFor(text: string): string[] {
  const fams = ['Noto Sans TC'];
  if (kana.test(text)) fams.push('Noto Sans JP');
  if (hangul.test(text)) fams.push('Noto Sans KR');
  return fams;
}

function parseRanges(s: string): [number, number][] {
  const out: [number, number][] = [];
  for (const part of s.split(',')) {
    const m = /U\+([0-9a-f]+)(?:-([0-9a-f]+))?/i.exec(part.trim());
    if (!m) continue;
    const a = parseInt(m[1], 16);
    out.push([a, m[2] ? parseInt(m[2], 16) : a]);
  }
  return out;
}

const cssCache = new Map<string, Promise<FontBlock[]>>();
const bytesCache = new Map<string, Promise<Uint8Array>>();

/** stylesheet → subset blocks (browser UA gets woff2 URLs automatically) */
function loadBlocks(families: string[]): Promise<FontBlock[]> {
  const url = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f.replace(/ /g, '+')}:wght@400;700`).join('&')}&display=swap`;
  let p = cssCache.get(url);
  if (!p) {
    p = (async () => {
      const css = await (await fetch(url)).text();
      const blocks: FontBlock[] = [];
      let n = 0;
      for (const m of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
        const body = m[1];
        const fam = /font-family:\s*'([^']+)'/.exec(body)?.[1];
        const weight = Number(/font-weight:\s*(\d+)/.exec(body)?.[1] ?? 400) as 400 | 700;
        const src = /url\((https:[^)]+\.woff2)\)/.exec(body)?.[1];
        const range = /unicode-range:\s*([^;]+)/.exec(body)?.[1];
        if (!fam || !src || !range) continue;
        const prio = families.indexOf(fam);
        if (prio < 0) continue;
        blocks.push({ key: `${fam}:${weight}:${n++}`, weight, prio, ranges: parseRanges(range), url: src });
      }
      if (!blocks.length) throw new Error('no font blocks');
      return blocks;
    })().catch((e) => { cssCache.delete(url); throw e; });
    cssCache.set(url, p);
  }
  return p;
}

/**
 * woff2 → raw TTF. fontkit can PARSE woff2 but cannot re-encode subsets from it (pdf-lib
 * subsetting needs real sfnt table streams), so we decompress with wawoff2 (Emscripten build of
 * Google's woff2). We import the BINDING directly and poll for readiness — the package's own
 * wrapper races onRuntimeInitialized and can hang forever in bundled browser builds.
 */
interface WawoffModule { decompress?: (b: Uint8Array) => Uint8Array | false; onRuntimeInitialized?: () => void }
let waMod: Promise<Required<Pick<WawoffModule, 'decompress'>>> | null = null;
function loadWawoff() {
  if (!waMod) {
    waMod = (async () => {
      // classic-script injection: Emscripten's web path. Bundling this file (Vite CJS transform)
      // breaks its environment detection and the runtime never initializes.
      const { default: src } = await import('wawoff2/build/decompress_binding.js?url');
      const mod: WawoffModule = {};
      (window as unknown as { Module: WawoffModule }).Module = mod;
      await new Promise<void>((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = () => resolve();
        el.onerror = () => reject(new Error('wawoff2 script failed'));
        document.head.appendChild(el);
      });
      await new Promise<void>((resolve, reject) => {
        const t0 = Date.now();
        mod.onRuntimeInitialized = () => resolve();
        const tick = () => {
          if (typeof mod.decompress === 'function') resolve();
          else if (Date.now() - t0 > 20000) reject(new Error('wawoff2 init timeout'));
          else window.setTimeout(tick, 50);
        };
        tick();
      });
      return mod as Required<Pick<WawoffModule, 'decompress'>>;
    })().catch((e) => { waMod = null; throw e; });
  }
  return waMod;
}
async function toTtf(woff2: Uint8Array): Promise<Uint8Array> {
  const mod = await loadWawoff();
  const out = mod.decompress(woff2);
  if (!out) throw new Error('woff2 decompress failed');
  return new Uint8Array(out);
}

function fetchBytes(url: string): Promise<Uint8Array> {
  let p = bytesCache.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`font ${r.status}`);
      return toTtf(new Uint8Array(await r.arrayBuffer()));
    }).catch((e) => { bytesCache.delete(url); throw e; });
    bytesCache.set(url, p);
  }
  return p;
}

/**
 * Build the font set for one document. Throws when offline / blocked — callers fall back to
 * rasterized output.
 */
export async function loadCjkFontSet(text: string, onProgress?: (p: number) => void): Promise<CjkFontSet> {
  const blocks = await loadBlocks(familiesFor(text));
  // unique codepoints (plus ASCII so UI-added strings always render)
  const cps = new Set<number>();
  for (let i = 0x20; i < 0x7f; i++) cps.add(i);
  for (const ch of text) cps.add(ch.codePointAt(0)!);

  const covers = (b: FontBlock, cp: number) => b.ranges.some(([a, z]) => cp >= a && cp <= z);
  const needed = blocks.filter((b) => { for (const cp of cps) if (covers(b, cp)) return true; return false; });
  // resolution caches per weight
  const pickCache = new Map<number, string>(); // (cp<<1|bold) → key
  const byWeight: Record<400 | 700, FontBlock[]> = { 400: [], 700: [] };
  for (const b of needed.sort((a, z) => a.prio - z.prio)) byWeight[b.weight].push(b);

  const pick = (cp: number, bold: boolean): string => {
    const ck = cp * 2 + (bold ? 1 : 0);
    const hit = pickCache.get(ck);
    if (hit !== undefined) return hit;
    const order: (400 | 700)[] = bold ? [700, 400] : [400, 700];
    let key = '';
    for (const w of order) {
      const b = byWeight[w].find((x) => covers(x, cp));
      if (b) { key = b.key; break; }
    }
    pickCache.set(ck, key);
    return key;
  };

  // download only what is actually reachable through pick()
  const usedKeys = new Set<string>();
  for (const cp of cps) {
    const a = pick(cp, false);
    const b = pick(cp, true);
    if (a) usedKeys.add(a);
    if (b) usedKeys.add(b);
  }
  const used = needed.filter((b) => usedKeys.has(b.key));
  const bytes = new Map<string, Uint8Array>();
  let done = 0;
  await Promise.all(used.map(async (b) => {
    bytes.set(b.key, await fetchBytes(b.url));
    onProgress?.(++done / used.length);
  }));

  const fallbackKey = pick(0x3f /* ? */, false);
  const segment = (t: string, bold: boolean): FontSeg[] => {
    const segs: FontSeg[] = [];
    let curKey: string | null = null;
    let buf = '';
    for (const ch of t) {
      let k = pick(ch.codePointAt(0)!, bold);
      let out = ch;
      if (!k) { k = fallbackKey; out = '?'; }
      if (k !== curKey) {
        if (buf) segs.push({ text: buf, key: curKey! });
        curKey = k;
        buf = out;
      } else buf += out;
    }
    if (buf && curKey) segs.push({ text: buf, key: curKey });
    return segs;
  };

  return { bytes, segment };
}
