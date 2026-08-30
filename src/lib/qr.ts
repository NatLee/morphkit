/**
 * QR codes — encode (node-qrcode) and decode (jsQR), both lazy-imported.
 * Decoding downsamples large images (QR finder patterns survive 800px fine) and retries
 * with an inverted / contrast-boosted copy for dark-mode screenshots.
 */

export interface QrStyle {
  /** module colour + background (hex); bg '' = transparent */
  fg: string;
  bg: string;
  /** pixels per edge of the exported PNG */
  size: number;
  /** quiet zone in modules */
  margin: number;
  ecl: 'L' | 'M' | 'Q' | 'H';
  /** optional centre logo (drawn over the middle ~22% — use ecl 'H') */
  logo?: Blob | null;
}

export const DEFAULT_QR: QrStyle = { fg: '#0a0e1c', bg: '#ffffff', size: 512, margin: 2, ecl: 'M', logo: null };

const qrcode = () => import('qrcode');
const jsqr = () => import('jsqr').then((m) => m.default);

/** Render a QR to a canvas (size×size). Throws when the payload exceeds QR capacity. */
export async function qrToCanvas(text: string, st: QrStyle): Promise<HTMLCanvasElement> {
  const Q = await qrcode();
  const c = document.createElement('canvas');
  await Q.toCanvas(c, text || ' ', {
    width: st.size,
    margin: st.margin,
    errorCorrectionLevel: st.ecl,
    color: { dark: st.fg, light: st.bg ? st.bg : '#0000' },
  });
  if (st.logo) {
    const bmp = await createImageBitmap(st.logo);
    const ctx = c.getContext('2d')!;
    const side = Math.round(st.size * 0.22);
    const x = (st.size - side) / 2;
    // white plate keeps the logo readable and the modules under it are recoverable via ECC
    ctx.fillStyle = st.bg || '#ffffff';
    ctx.fillRect(x - 6, x - 6, side + 12, side + 12);
    const r = Math.min(side / bmp.width, side / bmp.height);
    const w = bmp.width * r;
    const h = bmp.height * r;
    ctx.drawImage(bmp, (st.size - w) / 2, (st.size - h) / 2, w, h);
    bmp.close();
  }
  return c;
}

export async function qrToSvg(text: string, st: QrStyle): Promise<string> {
  const Q = await qrcode();
  return Q.toString(text || ' ', {
    type: 'svg',
    margin: st.margin,
    errorCorrectionLevel: st.ecl,
    color: { dark: st.fg, light: st.bg ? st.bg : '#0000' },
  });
}

export interface QrHit {
  text: string;
  /** corners in source-image pixels (top-left, top-right, bottom-right, bottom-left) */
  corners: { x: number; y: number }[];
}

function toImageData(src: ImageBitmap, maxDim: number, invert = false, boost = false): { data: ImageData; scale: number } {
  const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * scale));
  c.height = Math.max(1, Math.round(src.height * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  if (invert || boost) {
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      let g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      if (invert) g = 255 - g;
      if (boost) g = g > 128 ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = g;
    }
  }
  return { data, scale };
}

/** Decode the first QR found in an image blob (or null). */
export async function decodeQr(blob: Blob): Promise<QrHit | null> {
  const J = await jsqr();
  const bmp = await createImageBitmap(blob);
  try {
    const attempts: [number, boolean, boolean][] = [[1000, false, false], [1600, false, false], [1000, false, true], [1000, true, false], [600, false, false]];
    for (const [dim, inv, boost] of attempts) {
      const { data, scale } = toImageData(bmp, dim, inv, boost);
      const r = J(data.data, data.width, data.height, { inversionAttempts: inv ? 'onlyInvert' : 'dontInvert' });
      if (r && r.data) {
        const L = r.location;
        const pts = [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner];
        return { text: r.data, corners: pts.map((p) => ({ x: p.x / scale, y: p.y / scale })) };
      }
    }
    return null;
  } finally {
    bmp.close();
  }
}

/** Decode from a live video frame (camera scanning). */
export async function decodeFrame(video: HTMLVideoElement): Promise<string | null> {
  const J = await jsqr();
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, 800 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return J(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

/** Cheap classification of a decoded payload for the result UI. */
export function classifyPayload(text: string): 'url' | 'wifi' | 'vcard' | 'mail' | 'tel' | 'text' {
  const t = text.trim();
  if (/^https?:\/\//i.test(t)) return 'url';
  if (/^WIFI:/i.test(t)) return 'wifi';
  if (/^BEGIN:VCARD/i.test(t)) return 'vcard';
  if (/^mailto:/i.test(t)) return 'mail';
  if (/^tel:/i.test(t)) return 'tel';
  return 'text';
}

/** Payload builders for the generator templates. */
export const payloads = {
  wifi: (ssid: string, pass: string, auth: 'WPA' | 'WEP' | 'nopass', hidden = false) =>
    `WIFI:T:${auth};S:${escWifi(ssid)};${auth === 'nopass' ? '' : `P:${escWifi(pass)};`}${hidden ? 'H:true;' : ''};`,
  vcard: (v: { name: string; org?: string; tel?: string; email?: string; url?: string }) =>
    ['BEGIN:VCARD', 'VERSION:3.0', `FN:${v.name}`, `N:${v.name};;;;`, v.org ? `ORG:${v.org}` : '', v.tel ? `TEL:${v.tel}` : '', v.email ? `EMAIL:${v.email}` : '', v.url ? `URL:${v.url}` : '', 'END:VCARD'].filter(Boolean).join('\n'),
  mail: (to: string, subject: string, body: string) =>
    `mailto:${to}${subject || body ? `?${[subject && `subject=${encodeURIComponent(subject)}`, body && `body=${encodeURIComponent(body)}`].filter(Boolean).join('&')}` : ''}`,
};
const escWifi = (s: string) => s.replace(/([\\;,":])/g, '\\$1');
