import { createContext, useContext, useState, type ReactNode } from 'react';

export type Lang = 'zh' | 'en' | 'ja';

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'EN' },
  { code: 'ja', label: '日本語' },
];

type Dict = Record<string, string>;

const zh: Dict = {
  tagline: 'Simple file converter',
  heroA: '什麼都能',
  heroB: '轉。',
  heroSub: '圖片、音訊、影片 — 全部在你的瀏覽器內完成。',
  privacy: '檔案永遠不會離開你的裝置',
  dropTitle: '把檔案丟進來',
  dropHint: '或點擊選擇檔案 · 支援圖片 / 音訊 / 影片',
  browse: '選擇檔案',
  kindImage: '圖片',
  kindAudio: '音訊',
  kindVideo: '影片',
  targetLabel: '轉成',
  quality: '品質',
  convert: '轉換',
  converting: '轉換中…',
  convertAll: '全部轉換',
  clearAll: '全部清除',
  download: '下載',
  remove: '移除',
  retry: '重試',
  done: '完成',
  failed: '轉換失敗',
  engineLoading: '正在載入轉換引擎（約 31 MB，僅首次需要）…',
  engineError: '轉換引擎載入失敗，請檢查網路連線後重試。',
  warnLarge: '這個檔案很大（{size}）。瀏覽器內轉換受記憶體限制，可能失敗或非常慢。',
  warnHuge: '這個檔案超過瀏覽器的記憶體上限（約 1.8 GB），幾乎一定會失敗。建議改用桌面工具。',
  warnVideo: '影片轉換完全在你的電腦上執行，速度取決於裝置效能；大檔案建議耐心等候或裁小再轉。',
  unsupported: '不支援的檔案已略過：{names}',
  footerNote: '由 ffmpeg.wasm 與 Canvas API 驅動',
  themeToggle: '切換深淺色主題',
  settings: '轉換設定',
  workers: '平行工作數',
  workersHint: '每個 worker 是獨立的轉換引擎，數量越多越耗記憶體',
  audioBitrate: '音訊位元率',
  videoCrf: '影片品質 CRF',
  videoCrfHint: '數值越低品質越好、檔案越大',
  gifFps: 'GIF 幀率',
  gifWidth: 'GIF 寬度',
  queued: '排隊中…',
  details: '詳細資訊',
  duration: '時長',
  camera: '相機',
  lens: '鏡頭',
  iso: 'ISO',
  exposure: '快門',
  aperture: '光圈',
  focalLength: '焦距',
  taken: '拍攝時間',
  location: 'GPS 位置',
  openMap: '在地圖開啟',
  chooseFiles: '選擇檔案',
  supported: '支援的轉換格式',
  inLabel: '輸入',
  outLabel: '輸出',
  downloadAll: '全部下載 (ZIP)',
  filesSummary: '{n} 個檔案 · {size}',
  progressSummary: '完成 {done}/{total}',
  close: '關閉',
};

const en: Dict = {
  tagline: 'Simple file converter',
  heroA: 'Convert ',
  heroB: 'anything.',
  heroSub: 'Images, audio and video — converted entirely inside your browser.',
  privacy: 'Files never leave your device',
  dropTitle: 'Drop files here',
  dropHint: 'or click to browse · images / audio / video',
  browse: 'Browse files',
  kindImage: 'Image',
  kindAudio: 'Audio',
  kindVideo: 'Video',
  targetLabel: 'to',
  quality: 'Quality',
  convert: 'Convert',
  converting: 'Converting…',
  convertAll: 'Convert all',
  clearAll: 'Clear all',
  download: 'Download',
  remove: 'Remove',
  retry: 'Retry',
  done: 'Done',
  failed: 'Conversion failed',
  engineLoading: 'Loading conversion engine (~31 MB, first time only)…',
  engineError: 'Failed to load the engine. Check your connection and retry.',
  warnLarge: 'This file is large ({size}). In-browser conversion is memory-limited and may fail or be very slow.',
  warnHuge: 'This file exceeds the browser memory ceiling (~1.8 GB) and will almost certainly fail. Use a desktop tool instead.',
  warnVideo: 'Video conversion runs entirely on your machine — speed depends on your hardware. Be patient with big files.',
  unsupported: 'Unsupported files skipped: {names}',
  footerNote: 'Powered by ffmpeg.wasm & Canvas API',
  themeToggle: 'Toggle light / dark theme',
  settings: 'Conversion settings',
  workers: 'Parallel workers',
  workersHint: 'Each worker is an independent engine — more workers use more memory',
  audioBitrate: 'Audio bitrate',
  videoCrf: 'Video quality CRF',
  videoCrfHint: 'Lower = better quality, bigger file',
  gifFps: 'GIF frame rate',
  gifWidth: 'GIF width',
  queued: 'Queued…',
  details: 'Details',
  duration: 'Duration',
  camera: 'Camera',
  lens: 'Lens',
  iso: 'ISO',
  exposure: 'Shutter',
  aperture: 'Aperture',
  focalLength: 'Focal length',
  taken: 'Taken',
  location: 'GPS location',
  openMap: 'Open map',
  chooseFiles: 'Choose files',
  supported: 'Supported conversions',
  inLabel: 'Input',
  outLabel: 'Output',
  downloadAll: 'Download all (ZIP)',
  filesSummary: '{n} files · {size}',
  progressSummary: '{done}/{total} done',
  close: 'Close',
};

const ja: Dict = {
  tagline: 'Simple file converter',
  heroA: 'なんでも',
  heroB: '変換。',
  heroSub: '画像・音声・動画 — すべてブラウザの中だけで完結。',
  privacy: 'ファイルは端末の外に出ません',
  dropTitle: 'ここにファイルをドロップ',
  dropHint: 'クリックで選択も可 · 画像 / 音声 / 動画',
  browse: 'ファイルを選択',
  kindImage: '画像',
  kindAudio: '音声',
  kindVideo: '動画',
  targetLabel: '変換先',
  quality: '品質',
  convert: '変換',
  converting: '変換中…',
  convertAll: 'すべて変換',
  clearAll: 'すべてクリア',
  download: 'ダウンロード',
  remove: '削除',
  retry: '再試行',
  done: '完了',
  failed: '変換に失敗しました',
  engineLoading: '変換エンジンを読み込み中（約31MB・初回のみ）…',
  engineError: 'エンジンの読み込みに失敗しました。接続を確認して再試行してください。',
  warnLarge: 'このファイルは大きめです（{size}）。ブラウザ内変換はメモリ制限があり、失敗や極端な低速の可能性があります。',
  warnHuge: 'このファイルはブラウザのメモリ上限（約1.8GB）を超えており、ほぼ確実に失敗します。デスクトップツールをご利用ください。',
  warnVideo: '動画変換はすべてお使いのマシン上で実行されます。速度はハードウェア次第です。大きなファイルは気長にどうぞ。',
  unsupported: '未対応のファイルをスキップしました：{names}',
  footerNote: 'ffmpeg.wasm & Canvas API 駆動',
  themeToggle: 'ライト／ダークテーマ切替',
  settings: '変換設定',
  workers: '並列ワーカー数',
  workersHint: '各ワーカーは独立したエンジンです。増やすほどメモリを消費します',
  audioBitrate: '音声ビットレート',
  videoCrf: '動画品質 CRF',
  videoCrfHint: '低いほど高品質・大容量',
  gifFps: 'GIFフレームレート',
  gifWidth: 'GIF幅',
  queued: '待機中…',
  details: '詳細情報',
  duration: '再生時間',
  camera: 'カメラ',
  lens: 'レンズ',
  iso: 'ISO',
  exposure: 'シャッター',
  aperture: '絞り',
  focalLength: '焦点距離',
  taken: '撮影日時',
  location: 'GPS位置',
  openMap: '地図で開く',
  chooseFiles: 'ファイルを選択',
  supported: '対応する変換フォーマット',
  inLabel: '入力',
  outLabel: '出力',
  downloadAll: 'すべてダウンロード (ZIP)',
  filesSummary: '{n} 個のファイル · {size}',
  progressSummary: '完了 {done}/{total}',
  close: '閉じる',
};

const DICTS: Record<Lang, Dict> = { zh, en, ja };

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem('morphkit-lang') as Lang | null;
    if (saved && saved in DICTS) return saved;
  } catch { /* ignore */ }
  const nav = navigator.language.toLowerCase();
  if (nav.startsWith('zh')) return 'zh';
  if (nav.startsWith('ja')) return 'ja';
  return 'en';
}

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string>) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('morphkit-lang', l); } catch { /* ignore */ }
    document.documentElement.lang = l === 'zh' ? 'zh-Hant' : l;
  };

  const t = (key: string, vars?: Record<string, string>) => {
    let s = DICTS[lang][key] ?? DICTS.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  };

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
