# Map: lib/ modules, types.ts, i18n.tsx

> On-demand map for AI sessions. Read this INSTEAD of re-reading the source files for
> orientation; grep the names below to jump precisely. Update when structure changes.

## lib/ffmpegClient.ts (319)

Exports: `isEngineReady()` · `convertMedia(file, target, settings, edit, onProgress, onDownload?)` ·
`muxVideo(video, audioWav|null, trimStart, trimEnd, settings, onProgress, onDownload?)` ·
`extractAudio(video, trimStart, trimEnd, onDownload?)` (trim-aligned 44.1k stereo WAV; throws when
the video has no audio stream — header-only output is treated as failure) · `type DownloadProgress`.

Internals (greppable): `CORE_URL` (unpkg @ffmpeg/core 0.12.6 esm, **single-thread**, CDN-pinned) ·
`getCoreBlobs` (memoized, resets to null on failure for retry) · `pool`/`acquireEngine`/`releaseEngine`
(one job per instance; app semaphore caps growth) · `ART_CAPABLE = {mp3,m4a,flac}` ·
`metaOpts` (`-map_metadata 0`; mp3 += `-id3v2_version 3 -write_id3v1 1`) ·
`artOpts` (`-vn` unless keep+present+capable, else `-map 0:a -map 0:v:0? -c:v copy -disposition:v:0 attached_pic`) ·
`rateOpts(codec, s)` — CBR/VBR split: mp3 VBR `-q:a q`; vorbis ALWAYS quality-driven (`-q:a 10-q` VBR, `5` CBR);
aac/m4a always `-b:a` (native AAC VBR is experimental) · `audioOpts` (`-ar`/`-ac` when >0) ·
`trimOpts` (`-ss/-t` BEFORE `-i`) · `vfChain` (rotate → setpts → extra → scale) · `afChain` (volume → atempo) ·
`buildArgs(target, input, output, s, e?, input2?, hasArt)` switch: mp3/wav/ogg/flac/m4a/mp4/webm/gif/default ·
`sniffCoverArt` (first 64KiB latin1: APIC | covr | fLaC+image/).

Gotchas: art skipped whenever trim present (desync); convertMedia retries exec ONCE without art;
`data.slice()` copies out of wasm heap (keep); temp names `${Date.now()}_${rand}`; progress handler
removed in finally; muxVideo has its own trim thresholds + fixed `-b:a 192k`, ignores vfChain/videoMaxH.

## lib/useSplitter.ts (70)

`useSplitter(key, def, min, max, {invert?, axis?: 'x'|'y'})` → `{size, gutterProps}`. Draggable
panel-size state persisted to localStorage; spread `gutterProps` onto a `.split-gutter`/`.ie-gutter`
element (CSS must set touch-action:none). Pointer-captured drag clamps to [min,max]; dblclick resets
to `def`; `invert` = panel sits after the gutter (drag toward it grows). Used by ImageEditor
(layers panel), Studio (assets panel), VideoWorkspace (side width + preview height), GifEditor
(preview height).

## lib/animImage.ts (165)

Exports: `AnimFrame {img: ImageData; delay: ms}` · `Anim {frames, width, height}` · `decodeAnim(file)`
(GIF→gifuct manual disposal compositing / PNG|APNG→upng / static→createImageBitmap) · `encodeAPNG(anim)`
(UPNG.encode lossless, cnum 0) · `writeGifFrame(enc, data, w, h, delay, keepAlpha)` (shared with GifEditor) ·
`encodeGIFBlob(anim, matte|null)` (null keeps binary alpha) · `convertAnimImage(file, 'apng'|'gif')`.

Internals: `FRAME_CAP = 300` (both decoders; UI key `gifTooLong`) · delay floor `max(delay||100, 20)` ·
alpha GIF path = `quantize(rgba4444)` + `applyPalette rgba4444` + `{transparent:true, dispose:2}` (invariant 4) ·
`encodeGIFBlob` yields to event loop every 6th frame and composites through a tmp canvas (direct
putImageData would wipe the matte — keep).

## lib/imageConvert.ts (32)

`convertImage(file, 'png'|'jpeg'|'webp', quality, maxDim=0)` — createImageBitmap → optional
longest-edge downscale (never upscales) → toBlob. jpeg pre-fills `#ffffff`. Throws sentinel strings
`'decode' | 'canvas' | 'encode'`. Animated inputs collapse to frame 1 (animated targets → animImage).

## lib/metadata.ts (200)

Exports: `FileMeta` (all-optional: dims/duration/mime/modified/mp/aspect/bitrate/preview/title/artist/
album/hasCover/camera/lens/iso/exposure/aperture/focal/taken/gps) · `extractMeta(file, kind)` · `fmtDuration`.
Internals: `imageMeta` (preview = objectURL — caller revokes! · createImageBitmap dims · exifr.parse gps) ·
`mediaMeta` (detached video/audio el, idempotent `done()`, 5s watchdog, bitrate = size*8/dur/1000 estimate,
video thumb = 180px JPEG dataURL @ seek min(0.5, 10%)) · `readAudioTags` (first 256KiB latin1; ID3v2
syn-safe size, size sanity ≤400; MP4 atoms ©nam/©ART/©alb; hasCover = APIC|covr|fLaC+image/).
Never throws — missing fields are the failure mode.

## lib/formats.ts (~150)

Exports: `Kind` (image|audio|video|pdf|doc) · `IMAGE_OUTPUTS [webp png jpeg apng gif pdf]` · `PDF_OUTPUTS` ·
`DOC_TEXT_EXT`/`DOC_SHEET_EXT` · `DocType` + `docTypeOf(file)` (docx|text|md|html|sheet|json) · `docOutputs(file)`
(per sub-type list; sheets/json lead with xlsx/csv) · `outputsFor(kind, file?)` (file REQUIRED for docs) · `AUDIO_OUTPUTS [mp3 wav ogg flac m4a]` ·
`VIDEO_OUTPUTS [mp4 webm gif mp3]` · `LARGE_FILE_BYTES 200MB` · `HUGE_FILE_BYTES 1.8GB` · `extOf` ·
`detectKind` (MIME prefix then ext allow-lists; null = unsupported) · `outputsFor` · `defaultTarget`
(gif→apng / apng→gif FIRST, else webp/mp3/mp4 preference, jpg≡jpeg) · `outputFileName` (jpeg→.jpg) ·
`mimeFor` · `formatBytes`. Input ext lists wider than outputs (svg/avif/opus in, not out).
`apng` has NO ffmpeg path — must route to convertAnimImage.

## lib/settings.ts (64)

`Settings` + `DEFAULT_SETTINGS` + `loadSettings` (`{...defaults, ...parsed}` forward-compatible) +
`saveSettings` (swallows quota errors). Key `'morphkit-settings'`, unversioned — renaming a field
silently drops the user's value.
Fields (defaults): concurrency 2 · imageMaxDim 0 · audioBitrate '192k' · audioRateMode 'cbr' ·
audioQuality 2 · audioSampleRate 0 · audioChannels 0 · videoCrf 23 · videoPreset 'veryfast' ·
videoMaxH 0 · videoFps 0 · videoMute false · gifFps 12 · gifWidth 480 · keepMetadata true · keepCoverArt true.

## lib/idb.ts (95)

DB `'morphkit-studio'` v1: store `projects` (keyPath id) + `assets` (keyPath id, index `projectId`).
Exports: putProject/listProjects/deleteProject/putAsset/listAssets/deleteAsset ·
`createProjectWithAsset(name, kind, blob, type)` → ProjectRec (persists asset + typed project,
wiring baseAssetId/gifAssetId/videoAssetId per type; shared by Studio.newFromAsset and App's
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

## types.ts (40)

`Status = ready|queued|converting|done|error` · `MediaEdit {trimStart? trimEnd? volume?(0–2)
speed?(0.5–2, atempo limit) rotate?(0|90|180|270) mute? audioTrack?: File}` · `Item {id file kind target
quality status progress meta? edit? edited? outUrl? outName? outSize?}`.
`edit` = deferred (applied at ffmpeg time) vs `edited` = source File already rewritten by image/GIF editor.
`target` is a plain string — nothing type-checks it against the OUTPUT tuples.

## i18n.tsx (908)

Three flat dicts `zh` / `en` / `ja` (~281 keys each) at fixed ranges (zh ≈13–295, en ≈297–579, ja ≈581–863);
add new keys to ALL THREE at the matching position. `t(key, vars?)`: current lang → en → raw key
(missing keys render literally, no warning). Interpolation replaces only the FIRST `{var}` occurrence.
`detectLang`: localStorage `'morphkit-lang'` → navigator prefix → en. `LANGS` drives the switcher;
`setLang` also sets `document.documentElement.lang` (zh → 'zh-Hant').
Key families: `tool_*`, `warn*`, `sec*`, `audio*/video*/gif*`, `tag*`, `type*(+Desc)`, `tip*`, `kbd*`,
`mx*`, `feat*`. Interpolated keys: warnLarge{size} unsupported{names} filesSummary{n,size}
progressSummary{done,total} gifTooLong{n} dedupeDone{n} trackName{n} filesCount{n} tooBigGif{n} objectsCount{n}.
`t`/`setLang` are recreated every render (context identity changes each provider render).

## lib/pdf.ts (~560)

pdf.js + pdf-lib are BOTH lazy `import()`s (`pdfjs()` memo resets on failure; worker via
`pdf.worker.min.mjs?url`). **Read side** (pdf.js): `openPdf(bytes, password?)` (copies the buffer — pdf.js
transfers it; `onPassword` is intercepted and surfaced as `PdfPasswordError('need'|'wrong')`, never a prompt) ·
`closePdf(doc)` (the `PDFDocumentProxy` has no destroy; a WeakMap maps doc → loading task) · `sniffEncrypted`
(/Encrypt in the last 64 KiB) · `pageInfo(doc, i)` → {width, height (display pts), rotate (intrinsic)} ·
`readNotes` (/Text annots → user-space fractions) · `renderPage(doc, i, {width|scale, maxDim, rotate, white})` ·
`pdfInfo` · `pdfToImages(file, target, quality, maxDim, onProgress, password?)` → `{blob, multi}` (144 dpi;
multi-page → ZIP level 0) · `pdfToText` · `rasterizePdf` (plan B: every page → JPEG image page).
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
`mergeToPdf(inputs)` (PDFs w/ passwords + images), `imageToPdf`.

## lib/docs.ts (~520)

All libs lazy: `mammoth/mammoth.browser.js` (UMD — the node entry needs fs), `xlsx` (SheetJS), `marked`,
`pptxgenjs` (write side of lib/pptx.ts),
`turndown` + `turndown-plugin-gfm`, `docx`. **Read**: `sanitizeHtml` (drops script/style/frames/on*, keeps
data:/https: images) · `readSheets(file)` → `SheetInfo {names, rows}` (csv/tsv read as strings) · `docToHtml(file)`
(docx→mammoth, md→marked gfm, html→sanitize, sheet→tables (+h2 per sheet), json→table|pre, text→<p>+<br>).
**Write**: `htmlToText` (blocks → newlines, rows → tabs) · `htmlToMarkdown` (`normalizeTablesForMd` first:
unwrap <p> in cells, promote row 1 to <thead>/<th>) · `markdownToHtml` · `wrapHtmlDocument` (standalone page
with inline CSS) · block model `htmlToBlocks` → `Block` (heading|para{indent,quote,bullet}|pre|table|image|hr)
with inline `Run {bold italic code underline}` (+`pagebreak` from `hr[data-page-break]`; bare hr stays a rule)
— shared by the paginator, the docx writer and blocksToPptx · `layoutHtml(html,
PageStyle)` canvas paginator (A4 @2×, margin 56pt, 11pt body, `wrapRuns` breaks on spaces + every CJK char,
tables = equal columns, atomic rows, header tint; pre = clipped mono chunks; images fit width/70% height) ·
`htmlToPdf` (JPEG pages → `buildPdf` image specs) · `htmlToPngs` (1 page → PNG, else ZIP) · `htmlToDocx`
(docx lib: HeadingLevel, bullets, indent/border quotes, shaded code lines, tables w/ header shading, ImageRun ≤600px)
· sheets `sheetsToXlsx sheetsToCsv (multi → ZIP) sheetsToJson rowsToMarkdown` · `convertDoc(file, target,
onProgress)` → `{blob, multi}` (sheet/json fast path for xlsx/csv/json/md; else html → target). **Editor bridge**:
`EditMode`, `docEditSource` (docx → markdown via html), `previewHtml`, `docSave` (docx/xlsx regenerated; csv/tsv
and text formats saved verbatim).

## lib/pptx.ts (~230)

READ (no library): fflate `unzipSync` + DOMParser('application/xml'); helpers `relsOf` (part → .rels map,
relative-target resolution), `q`/`local` (localName matching — prefixes vary). `pptxToHtml(file)`:
slide order from presentation.xml `sldId`→rels; per slide walk `spTree` (`sp` → `shapeHtml` — a:p runs
w/ b/i, `lvl`-nested <ul>, first title/ctrTitle placeholder → <h3>; `pic` → media data URI ≤8 MB;
`graphicFrame`→a:tbl → <table>; `grpSp` recursed); slides separated by `<hr data-page-break>`
(→ `---` in md, page break in pdf/docx). WRITE: `blocksToPptx(blocks, title)` (pptxgenjs lazy, WIDE 16:9):
h1/h2 = new slide + title, h3+ = bold line, paras/pre = bullet lines (indentLevel), tables → addTable,
data-URI images bottom-right, hr/pagebreak = slide break.

## lib/qr.ts (~130)

`qrToCanvas(text, QrStyle)` (node-qrcode; bg '' → '#0000' transparent; centre logo drawn on a plate,
use ecl H) · `qrToSvg` · `decodeQr(blob)` → `QrHit {text, corners}` (jsQR over attempts:
1000/1600px, invert, contrast-boost, 600px — dark screenshots need the retries) · `decodeFrame(video)`
(camera loop) · `classifyPayload` (url/wifi/vcard/mail/tel/text) · `payloads.wifi/vcard/mail` ·
`DEFAULT_QR`.

## lib/qpdf.ts (~60)

`@jspawn/qpdf-wasm` (Emscripten CLI, MODULARIZE) — lazy: `qpdf.mjs` + `qpdf.wasm?url` (1.3 MB, first use
only). `run(args, input)` spins a FRESH module per call (`noInitialRun`, `locateFile` → wasm URL), writes
`/in.pdf`, `callMain([...args, '/in.pdf', '/out.pdf'])`, exit 0/3 ok else `QpdfError(log, code)`.
`decryptPdf(bytes, pw)` = `--password=… --decrypt`; `encryptPdf(bytes, user, owner)` = `--encrypt user owner
256 --` (owner falls back to user). Types via `declare module` in gif-libs.d.ts.
