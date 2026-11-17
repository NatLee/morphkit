# Map: lib/ modules, types.ts, i18n.tsx

> On-demand map for AI sessions. Read this INSTEAD of re-reading the source files for
> orientation; grep the names below to jump precisely. Update when structure changes.

## lib/ffmpegClient.ts (464)

Exports: `isEngineReady()` · `convertMedia(file, target, settings, edit, onProgress, onDownload?, fit?: FitTarget)` ·
`muxVideo(video, audioWav|null, trimStart, trimEnd, settings, onProgress, onDownload?)` ·
`extractAudio(video, trimStart, trimEnd, onDownload?)` (trim-aligned 44.1k stereo WAV; throws when
the video has no audio stream — header-only output is treated as failure) · `type DownloadProgress` ·
`buildArgs` and `fitWithin` (exported for the unit tests in tests/ffmpegArgs.test.ts) · `noStreamInLog(lines)`
(ffmpeg's "does not contain any stream" / "matches no streams": for an audio target that means the source
has no sound → convertMedia throws `ConvertError('noAudioTrack')`; it collects the log via `ff.on('log')`) ·
size target: `FitTarget {maxBytes, duration?}` (only the converter passes one; Studio never does) ·
`AV_TARGETS` (mp4/webm: outputs with picture AND sound — audio replacement and the size target) ·
`VIDEO_AUDIO_KBPS` (128, AAC in MP4 and the budget set aside for sound) · `mediaSeconds(duration, edit)`
(trimmed span ÷ speed) · `videoKbpsFor(maxBytes, seconds, audioKbps)` (95% of the budget; below 50 kbps
throws `ConvertError('fitTooSmall')`) · loudness (invariant 31, tests/loudness.test.ts): `loudnessProbeArgs(input, lufs, trim)`
(`-vn … loudnorm=…:print_format=json -f null -`), `parseLoudness(lines)` → `LoudnessMeasure` | null (no block or -inf),
`audioFormatInLog(lines)` → `AudioFormat {sampleRate, layout}` | null (first input `Audio:` line; "N channels" = unknown),
`loudnormFor(lufs, m, source)` → the second-pass filter STRING (linear loudnorm + `aformat` back to the source,
48 kHz stereo fallback).

Internals (greppable): `CORE_URL` (unpkg @ffmpeg/core 0.12.6 esm, **single-thread**, CDN-pinned) ·
`getCoreBlobs` (memoized, resets to null on failure for retry) · `pool`/`acquireEngine`/`releaseEngine`
(one job per instance; app semaphore caps growth) · `ART_CAPABLE = {mp3,m4a,flac}` ·
`metaOpts` (`-map_metadata 0`; mp3 += `-id3v2_version 3 -write_id3v1 1`) ·
`artOpts` (`-vn` unless keep+present+capable, else `-map 0:a -map 0:v:0? -c:v copy -disposition:v:0 attached_pic`) ·
`rateOpts(codec, s)` — CBR/VBR split: mp3 VBR `-q:a q`; vorbis ALWAYS quality-driven (`-q:a 10-q` VBR, `5` CBR);
aac/m4a always `-b:a` (native AAC VBR is experimental) · `audioOpts` (`-ar`/`-ac` when >0) ·
`trimOpts` (`-ss/-t` BEFORE `-i`) · `vfChain` (rotate → setpts → extra → one `fitWithin` size cap: GIF width × videoMaxH, downscale-only) · `afChain(e, loudnorm?)` (loudnorm → volume → atempo) ·
`videoRate(codec, s, kbps?)` (CRF normally; `-b:v` + x264 `-maxrate`/`-bufsize` with a size target) ·
`buildArgs(target, input, output, s, e?, {input2, hasArt, videoKbps, loudnorm}: BuildOpts)` switch: mp3/wav/ogg/flac/m4a/mp4/webm/gif/default ·
`sniffCoverArt` (first 64KiB latin1: APIC | covr | fLaC+image/) — only called for AUDIO sources (`detectKind`).

Gotchas: art skipped whenever trim present (desync); convertMedia retries exec ONCE without art, and
with a size target re-encodes ONCE at a lower rate when the output is still too big — every exec passes
`-y` because those retries reuse the output name (ffmpeg would ask before overwriting, and gets no answer);
no readable duration with a target set → `ConvertError('fitNoDuration')` before the engine is taken;
`data.slice()` copies out of wasm heap (keep); temp names `${Date.now()}_${rand}`; progress handler
removed in finally; muxVideo has its own trim thresholds + fixed `-b:a 192k`, ignores vfChain/videoMaxH.

## lib/useSplitter.ts (66)

`useSplitter(key, def, min, max, {invert?, axis?: 'x'|'y'})` → `{size, gutterProps}`. Draggable
panel-size state persisted to localStorage; spread `gutterProps` onto a `.split-gutter`/`.ie-gutter`
element (CSS must set touch-action:none). Pointer-captured drag clamps to [min,max]; dblclick resets
to `def`; `invert` = panel sits after the gutter (drag toward it grows). Used by ImageEditor
(layers panel), Studio (assets panel), VideoWorkspace (side width + preview height), GifEditor
(preview height), PdfEditor (preview width).

## lib/animImage.ts (165)

Exports: `AnimFrame {img: ImageData; delay: ms}` · `Anim {frames, width, height}` · `decodeAnim(file)`
(GIF→gifuct manual disposal compositing / PNG|APNG→upng / static→createImageBitmap) · `encodeAPNG(anim)`
(UPNG.encode lossless, cnum 0) · `writeGifFrame(enc, data, w, h, delay, keepAlpha)` (shared with GifEditor) ·
`encodeGIFBlob(anim, matte|null)` (null keeps binary alpha) · `convertAnimImage(file, 'apng'|'gif')`.

Internals: `FRAME_CAP = 300` (both decoders; frames past it are dropped without a message — the
`gifTooLong` i18n key exists but nothing shows it) · delay floor `max(delay||100, 20)` ·
alpha GIF path = `quantize(rgba4444)` + `applyPalette rgba4444` + `{transparent:true, dispose:2}` (invariant 4) ·
`encodeGIFBlob` yields to event loop every 6th frame and composites through a tmp canvas (direct
putImageData would wipe the matte — keep).

## lib/imageConvert.ts (183)

`convertImage(file, 'png'|'jpeg'|'webp', quality, maxDim=0, maxBytes=0)` — createImageBitmap → optional
longest-edge downscale (never upscales) → toBlob; with `maxBytes` the encode goes through `fitToSize`.
`fitToSize(encode: Encoder, maxBytes, maxQuality, minQuality = MIN_QUALITY)`: highest quality that fits
(binary search, 0.02 steps); when even `minQuality` is too big, scale by √(target/size) × 0.9 and search
again (≤ 6 shrinks, then `ConvertError('fitTooSmall')`). PNG passes `minQuality = maxQuality`, so only
its size moves. `MIN_QUALITY` (0.4) is also the minimum of both quality sliders.
ICO: `ICO_SIZES` [16 24 32 48 64 128 256] · `icoSizesFor(w, h)` (sizes ≤ the longest side, at least 16) ·
`encodeIco(images)` (ICONDIR + 16-byte entries + PNG data; 256 written as 0) · `convertToIco(file)` (halves
the source down to the largest icon, then draws each smaller size from the previous one — never > 2× per
step; contain-fit, centred on a transparent square). jpeg pre-fills `#ffffff`. Throws sentinel strings
`'decode' | 'canvas' | 'encode'`. Animated inputs collapse to frame 1 (animated targets → animImage).

## lib/metadata.ts (280)

Exports: `FileMeta` (all-optional: dims/duration/mime/modified/mp/aspect/bitrate/preview/title/artist/
album/hasCover/camera/lens/iso/exposure/aperture/focal/taken/gps, PDF pages/author/encrypted, `qr`,
document words/chars/lines/sheets/slides) · `extractMeta(file, kind, password?)` · `fmtDuration`.
Internals: `imageMeta` (preview = objectURL, owned by `useBlobUrlOwner` once it is in App state ·
createImageBitmap dims · exifr.parse gps · QR decode, invariant 26) · `pdfMeta` · `docMeta` (`countWords`) ·
`mediaMeta` (detached video/audio el, idempotent `done()`, 5s watchdog, bitrate = size*8/dur/1000 estimate,
video thumb = 180px JPEG dataURL @ seek min(0.5, 10%)) · `readAudioTags` (first 256KiB latin1; ID3v2
syn-safe size, size sanity ≤400; MP4 atoms ©nam/©ART/©alb; hasCover = APIC|covr|fLaC+image/).
Never throws — missing fields are the failure mode.

## lib/formats.ts (164)

Exports: `Kind` (image|audio|video|pdf|doc) · `IMAGE_OUTPUTS [webp png jpeg apng gif pdf ico txt]` · `SLOW_IMAGE_OUTPUTS` (pdf, txt: queued through the semaphore, every other image output runs at once) · `PDF_OUTPUTS` ·
`DOC_TEXT_EXT`/`DOC_SHEET_EXT` · `DocType` + `docTypeOf(file)` (docx|pptx|text|md|html|sheet|json) · `isTextDoc`
(md/text/html/json — the docs that can be Studio text projects) · `DOC_OUTPUTS` (record per sub-type; first
entry = default; sheets/json lead with xlsx/csv) + `docOutputs(file)` · `outputsFor(kind, file?)` (file REQUIRED for docs) · `AUDIO_OUTPUTS [mp3 wav ogg flac m4a]` ·
`VIDEO_OUTPUTS [mp4 webm gif ...AUDIO_OUTPUTS]` · `LARGE_FILE_BYTES 200MB` · `HUGE_FILE_BYTES 1.8GB` · `extOf` ·
`detectKind` (MIME prefix then ext allow-lists; null = unsupported) · `ACCEPT` (file-picker list built from
the same lists) · `outputsFor` · `defaultTarget`
(gif→apng / apng→gif FIRST, else webp/mp3/mp4 preference, jpg≡jpeg) · `formatLabel` (jpeg→JPG, else upper
case; FormatMatrix chips) · `outputFileName` (jpeg→.jpg) ·
`mimeFor` · `formatBytes`. Input ext lists wider than outputs (svg/avif/opus in, not out).
`apng` has NO ffmpeg path — must route to convertAnimImage; `ico` has none either — App routes it to `convertToIco`; image `txt` goes to `imageToText` (lib/ocr).

## lib/settings.ts (85)

`Settings` + `DEFAULT_SETTINGS` + `loadSettings` (`{...defaults, ...parsed}` forward-compatible) +
`saveSettings` (swallows quota errors). Key `'morphkit-settings'`, unversioned — renaming a field
silently drops the user's value.
Fields (defaults): concurrency 2 · imageMaxDim 0 · imageTargetSize 0 · audioBitrate '192k' · audioRateMode 'cbr' ·
audioQuality 2 · audioSampleRate 0 · audioChannels 0 · defaultQuality 0.9 · pdfImageScale 2 ·
docPageSize a4 · docFontSize 11 · docPdfText true · videoCrf 23 · videoPreset 'veryfast' ·
videoMaxH 0 · videoFps 0 · videoMute false · videoTargetSize 0 · gifFps 12 · gifWidth 480 · keepMetadata true · keepCoverArt true ·
audioLoudness 0 · ocrLang 'auto' (type `OcrLangSetting` from lib/ocr).

## lib/idb.ts (93)

DB `'morphkit-studio'` v1: store `projects` (keyPath id) + `assets` (keyPath id, index `projectId`).
Exports: putProject/listProjects/deleteProject/putAsset/listAssets/deleteAsset ·
`createProjectWithAsset(name, kind, blob, type)` → ProjectRec (persists asset + typed project,
wiring baseAssetId/gifAssetId/videoAssetId/pdfAssetId/textAssetId per type; shared by Studio.newFromAsset and App's
"open as project"). Each helper opens a fresh one-shot transaction → `deleteProject` is NOT atomic
(sequential asset deletes). Version bump requires guarding the unconditional createObjectStore
calls in onupgradeneeded.

## lib/wav.ts (35)

`audioBufferToWav(buf)` → 16-bit PCM WAV blob. Channels clamped to 2 (dropped, not downmixed);
asymmetric scale (±0x8000/0x7fff); per-sample JS loop (long mixes block the main thread).

## lib/audioEngine.ts (130)

`audioCtx()` (lazy singleton — never at module load, invariant 12) · `decodeAssetBuffer(id, blob)`
(memoized in module `cache`) · `getCachedBuffer(id)` (sync peek) · `dropAssetBuffer(id)` ·
`mixDuration(doc)` · `PlayHandle {stop, t0, from}` · `playMix(doc, from)` · `renderMixWav(doc)`
(OfflineAudioContext 2ch/44.1k; throws `'empty mix'`) · `peaks(buf, offset, duration, count)`.
Private `buildGraph` honours mute + any-solo (non-solo → gain 0). Playback pos = `from + (currentTime - t0)`.

## types.ts (44)

`Status = ready|queued|converting|done|error` · `MediaEdit {trimStart? trimEnd? volume?(0–2)
speed?(0.5–2, atempo limit) rotate?(0|90|180|270) mute? audioTrack?: File}` · `Item {id file kind target
quality status progress meta? edit? edited? outUrl? outName? outSize? error? pdfPassword?}` (`error` = a
ConvertError key; `pdfPassword` lives in memory only, invariant 25).
`edit` = deferred (applied at ffmpeg time) vs `edited` = source File already rewritten by image/GIF editor.
`target` is a plain string — nothing type-checks it against the OUTPUT tuples.

## i18n.tsx (1700)

Three flat dicts `zh` / `en` / `ja` (~536 keys each), one after the other (grep "const en: Dict");
add new keys to ALL THREE at the matching position. `t(key, vars?)`: current lang → en → raw key
(missing keys render literally, no warning). Interpolation replaces only the FIRST `{var}` occurrence.
`detectLang`: localStorage `'morphkit-lang'` → navigator prefix → en. `LANGS` drives the switcher;
`setLang` also sets `document.documentElement.lang` (zh → 'zh-Hant').
Key families: `tool_*`, `warn*`, `sec*`, `audio*/video*/gif*`, `tag*`, `type*(+Desc)`, `tip*`, `kbd*`,
`mx*`, `feat*`. Interpolated keys: warnLarge{size} unsupported{names} filesSummary{n,size}
progressSummary{done,total} gifTooLong{n} dedupeDone{n} trackName{n} filesCount{n} tooBigGif{n} objectsCount{n}
pdfPagesN{n} pdfSummary{n,sel} pdfScopeAll{n} pdfScopeSel{n} docWordsN{n} docStats{words,lines,chars}
shShowMore{n} shStats{rows,cols,sheets} docSlidesN{n} (gifTooLong and objectsCount are no longer shown anywhere).
`t`/`setLang` are recreated every render (context identity changes each provider render).

## lib/pdf.ts (685)

pdf.js + pdf-lib are BOTH lazy `import()`s (`pdfjs()` memo resets on failure; worker via
`pdf.worker.min.mjs?url`). **Read side** (pdf.js): `openPdf(bytes, password?)` (copies the buffer — pdf.js
transfers it; `onPassword` is intercepted and surfaced as `PdfPasswordError('need'|'wrong')`, never a prompt) ·
`closePdf(doc)` (the `PDFDocumentProxy` has no destroy; a WeakMap maps doc → loading task) · `sniffEncrypted`
(/Encrypt in the last 64 KiB) · `pageInfo(doc, i)` → {width, height (display pts), rotate (intrinsic)} ·
`readNotes` (/Text annots → user-space fractions) · `renderPage(doc, i, {width|scale, maxDim, rotate, white})` ·
`pdfInfo` · `pdfToImages(file, target, quality, maxDim, onProgress, password?, scale = 2)` → `{blob, multi}` (scale from
`settings.pdfImageScale`: 72/144/216 dpi; multi-page → ZIP level 0) · `pdfToText(file, onProgress, password?, readScan?)` (a page without a text layer is rendered at `OCR_DPI` 300, capped at `OCR_MAX_DIM`, and handed to `readScan` = the OCR reader; pages joined by `joinPageText`, which throws `ConvertError("pdfNoText")` when no page has text even after OCR) · `rasterizePdf` (plan B: every page → JPEG image page).
**Decrypt bridge**: `getPlainBytes(file, password, encrypted)` — WeakMap-cached qpdf decrypt; throws
`PdfPasswordError('wrong')` when qpdf's log mentions the password.
**Write side** (pdf-lib): `PageSpec` union (pdf bytes+index | image blob+size | blank) × `PageCommon {rotate,
flipH, flipV, notes, overlay, watermark}` · `buildPdf(specs, BuildOpts {title, author, watermark, encrypt,
onProgress})`: one `PDFDocument.load` per distinct PLAIN buffer, one bulk `copyPages` per source (repeats copy
singly), `stripTextAnnots` then `addNotes` (UTF-16 /Contents so CJK survives), `flipPage` (embedPage redrawn
with negative scale — drops links/forms), overlay + watermark drawn as user-space PNGs over the media box,
`setRotation`, then optional qpdf `encryptPdf`. Watermark helpers shared with the editor preview:
`watermarkCanvas(wm)` (canvas text → CJK without fonts), `drawWatermarkPreview(ctx, W, H, wm, art)` (center |
tile rhythm). Coordinate helpers: `userToDisplay`/`displayToUser` (fractions), `userToDisplayCanvas`/
`displayToUserCanvas` (rotate + flips). `A4`, `imagePageSize` (px × 0.75), `isPdfFile`, `MergeInput`,
`mergeToPdf(inputs)` (PDFs w/ passwords + images), `imageToPdf`, `imageForPdf`.

## lib/docs.ts (589)

All libs lazy: `mammoth/mammoth.browser.js` (UMD — the node entry needs fs), `xlsx` (SheetJS), `marked`,
`pptxgenjs` (write side of lib/pptx.ts),
`turndown` + `turndown-plugin-gfm`, `docx`. **Read**: `sanitizeHtml` (drops script/style/frames/on*, keeps
data:/https: images) · `readSheets(file)` → `SheetInfo {names, rows}` (csv/tsv read as strings) · `docToHtml(file)`
(docx→mammoth, pptx→lib/pptx, md→marked gfm, html→sanitize, sheet→tables (+h2 per sheet), json→table|pre, text→<p>+<br>) ·
`countWords` (each CJK character counts as a word; Markdown symbols do not — FileCard and DocEditor share it).
**Write**: `htmlToText` (blocks → newlines, rows → tabs) · `htmlToMarkdown` (`normalizeTablesForMd` first:
unwrap <p> in cells, promote row 1 to <thead>/<th>) · `markdownToHtml` · `wrapHtmlDocument` (standalone page
with inline CSS) · block model `htmlToBlocks` → `Block` (heading|para{indent,quote,bullet}|pre|table|image|hr)
with inline `Run {bold italic code underline}` (+`pagebreak` from `hr[data-page-break]`; bare hr stays a rule)
— shared by the lib/docPaint layout engine, the docx writer and blocksToPptx · page sizes `A4`/`LETTER` ·
`htmlToPdf(html, title, onProgress?, mode: PdfTextMode, style)` ('text' → docPaint `renderPdfBlob`, falling back to
'raster' on any failure; 'raster' → docPaint `renderCanvases` JPEG pages → `buildPdf`) · `htmlToPngs` (1 page → PNG,
else ZIP) · `htmlToDocx`
(docx lib: HeadingLevel, bullets, indent/border quotes, shaded code lines, tables w/ header shading, ImageRun ≤600px)
· sheets `sheetsToXlsx sheetsToCsv (multi → ZIP) sheetsToJson rowsToMarkdown` · `convertDoc(file, target,
onProgress?, opts: ConvertDocOpts {pdfText, pageSize, fontSize})` → `{blob, multi}` (sheet/json fast path for xlsx/csv/json/md; else html → target). **Editor bridge**:
`EditMode`, `docEditSource` (docx/pptx → markdown via html), `previewHtml`, `docSave` (docx/pptx/xlsx regenerated;
csv/tsv and text formats saved verbatim).

## lib/pptx.ts (218)

READ (no library): fflate `unzipSync` + DOMParser('application/xml'); helpers `relsOf` (part → .rels map,
relative-target resolution), `q`/`local` (localName matching — prefixes vary). `pptxToHtml(file)`:
slide order from presentation.xml `sldId`→rels; per slide walk `spTree` (`sp` → `shapeHtml` — a:p runs
w/ b/i, `lvl`-nested <ul>, first title/ctrTitle placeholder → <h3>; `pic` → media data URI ≤8 MB;
`graphicFrame`→a:tbl → <table>; `grpSp` recursed); slides separated by `<hr data-page-break>`
(→ `---` in md, page break in pdf/docx). WRITE: `blocksToPptx(blocks, title)` (pptxgenjs lazy, WIDE 16:9):
h1/h2 = new slide + title, h3+ = bold line, paras/pre = bullet lines (indentLevel), tables → addTable,
data-URI images bottom-right, hr/pagebreak = slide break.

## lib/qr.ts (147)

`qrToCanvas(text, QrStyle)` (node-qrcode; bg '' → '#0000' transparent; centre logo drawn on a plate,
use ecl H) · `qrToSvg` · `decodeQr(blob)` → `QrHit {text, corners}` (jsQR over attempts:
1000/1600px, invert, contrast-boost, 600px — dark screenshots need the retries) · `decodeFrame(video)`
(camera loop) · `classifyPayload` (url/wifi/vcard/mail/tel/text) · `payloads.wifi/vcard/mail` ·
`DEFAULT_QR`.

## lib/docPaint.ts (383) + lib/cjkFont.ts (206)

docPaint: `DEFAULT_STYLE` (A4 @2×, margin 56pt, 11pt body) · `Painter` interface (top-down device px: newPage/measure/text/rect/frame/image) ·
`renderBlocks` = the pagination brain (wrapRuns breaks on spaces + CJK chars; headings, bullets,
quote bars, shaded code w/ fitText truncation, equal-column tables w/ header tint, images fit
width/70% height, `pagebreak` blocks) · `CanvasPainter`/`renderCanvases` (raster) ·
`PdfPainter`/`renderPdfBlob` (pdf-lib: pt = px/scale, y flipped; text drawn per cjkFont segment;
registerFontkit + `embedFont(ttf, {subset:true})`; throws when fonts can't load → docs.ts
`htmlToPdf` catches and rasters). cjkFont: `loadCjkFontSet(text)` — families by script
(TC always, JP on kana, KR on hangul), css2 `unicode-range` blocks filtered to the doc's
codepoints, per-cp `pick` cache, woff2→TTF via `loadWawoff` (classic-script injection +
decompress poll — see CLAUDE.md invariant 28), `segment(text, bold)` for mixed-font runs.

## lib/qpdf.ts (67)

`@jspawn/qpdf-wasm` (Emscripten CLI, MODULARIZE) — lazy: the CJS `qpdf.js` (its `qpdf.mjs` wrapper breaks under
Rollup) + `qpdf.wasm?url` (1.3 MB, first use
only). `run(args, input)` spins a FRESH module per call (`noInitialRun`, `locateFile` → wasm URL), writes
`/in.pdf`, `callMain([...args, '/in.pdf', '/out.pdf'])`, exit 0/3 ok else `QpdfError(log, code)`.
`decryptPdf(bytes, pw)` = `--password=… --decrypt`; `encryptPdf(bytes, user, owner)` = `--encrypt user owner
256 --` (owner falls back to user). Types via `declare module` in gif-libs.d.ts.

## lib/ocr.ts (150)

Text recognition with tesseract.js 7 (lazy `import('tesseract.js')`; worker, SIMD LSTM core and
`@tesseract.js-data/<lang>/4.0.0_best_int` all come from tesseract.js's DEFAULT jsdelivr locations — `OCR_HOST`,
also in the host list of public/sw.js). `OCR_LANGS` (eng chi_tra chi_sim jpn kor → endonyms) · `OcrLang`/`OcrLangSetting`
('auto' + codes) · `ocrLangs(setting, uiLang)` (`AUTO_LANG` zh→chi_tra, ja→jpn, en→eng; English appended) ·
`ocrDownloadBytes(langs)` (`ENGINE_BYTES` once + `LANG_BYTES` per language not yet in localStorage
`morphkit-ocr-langs`; 0 = nothing to ask) · `OCR_ENGINE_VERSION` (the sizes were measured for it; a test compares
it with node_modules) · `OcrConsent`/`OcrRead` · `withOcr(langs, consent, fn, onReading?)` (lazy engine on first
read; consent false → `ocrDeclined`, load failure → `ocrLoadFailed`; `NO_SPACE_LANGS` → preserve_interword_spaces;
`remember` after a successful load; worker terminated in `finally`; the state lives in an object because TS
narrowing in `finally` cannot see the closure's assignment) · `imageToText(file, langs, consent, onProgress?)`
(white-flattened canvas; empty → `ocrNoText`). Tests: tests/ocr.test.ts (tesseract.js mocked).

## lib/errors.ts (12)

`ConvertError(key)` — a conversion failure the user can act on. `key` is an i18n key whose message says
what went wrong and what to try instead. Throw it where the problem is detected (`joinPageText` in pdf.ts
throws `pdfNoText`); App (runConvert) stores `key` on `Item.error` and FileCard renders it in place of
the generic `failed` message. No per-format branches in the UI.

## lib/useBlobUrlOwner.ts (27)

`useBlobUrlOwner(urls)` — owns the blob: URLs a component keeps in state (App: every `outUrl` and
`meta.preview`; Studio: launcher thumbs). After each commit it revokes the URLs that are no longer
listed, and the rest on unmount — so code only drops or replaces URLs in state and never revokes them
by hand (invariant 2). Tested in tests/useBlobUrlOwner.test.ts.
