# MorphKit — Context for AI assistants

Read this file first. It replaces the need to re-read the whole codebase.

## What this is

100% static in-browser file converter + editors (image/audio/video/GIF/APNG/PDF/documents).
No backend, no uploads. Deployed to GitHub Pages via `.github/workflows/deploy.yml`
(repo Settings → Pages → Source: GitHub Actions). Vite `base: './'` so any repo name works.

Stack: Vite + React 18 + TypeScript (strict). No CSS framework — single `src/styles.css`
with CSS variables. No state library — App.tsx owns all state.

Installable PWA: `public/manifest.webmanifest` + `public/sw.js` (offline app-shell cache,
registered PROD-only in `main.tsx`) + `public/icons/*` (brand-mark PNGs — regenerate with
`node scripts/gen-icons.mjs` from the repo root).

## Commands

```bash
npm run dev            # dev server
npm test               # unit tests: Vitest + jsdom, files in tests/ (no setup file; mocks are per test)
npm run build          # tsc && vite build  (MUST pass before committing)
npm run preview        # serve dist/ with the service worker registered
npm run check:context  # this file + docs/claude/ still match the source
```

CI (`.github/workflows/ci.yml`) runs `npm test` and `npm run build` on every pull request; the
Pages workflow calls it before building, so main is tested once per push.

Sandbox note: the mounted FS may refuse to delete `dist/`; build with
`npx vite build --outDir /tmp/morphkit-dist --emptyOutDir` to verify instead.
Windows note: run Vitest from a path with an upper-case drive letter (`C:\…`); from `c:\…` it
loads modules twice and every suite fails with "Cannot read properties of undefined (reading 'config')".

## Context economy — read maps, not source

Per-subsystem maps live in `docs/claude/`. **Read the map INSTEAD of the big source file**
for orientation; then grep the exact names it gives you. Do NOT `@import` them here
(imports would load every session). When you change a mapped file's structure, spend the
one or two lines to update its map.

| Map | Read before opening |
|---|---|
| `docs/claude/app-shell.md` | App.tsx, Hero, DropZone, FileCard, SettingsPanel, FormatMatrix, DualRange, Overlay, ConfirmDialog, FramePicker, InfoTip, InstallPrompt |
| `docs/claude/editors.md` | ImageEditor.tsx (2k lines), GifEditor.tsx, PdfEditor.tsx, PdfPasswordModal.tsx, DocEditor.tsx, SheetEditor.tsx, QrTool.tsx |
| `docs/claude/studio.md` | Studio.tsx (1.4k), Mixer.tsx, VideoWorkspace.tsx, MediaEditor.tsx |
| `docs/claude/libs.md` | every lib/*.ts, types.ts, i18n.tsx mechanics |
| `docs/claude/styles.md` | styles.css section index + responsive/mobile architecture |

Project skills: `/add-setting` (new converter param), `/add-format` (new format).
`.claude/settings.json` pre-approves `npx tsc`, builds, and read-only git commands.
Map maintenance is ENFORCED: `npm run check:context` (also a Stop hook, and a non-blocking job
in deploy.yml on pushes to main) fails on stale map tokens, unmapped src files, HEAD_W↔CSS desync,
and i18n key or `{placeholder}` gaps. Rules, triggers, and rationale: `docs/claude/README.md`.

## File map (src/)

### App shell & converter

| File | Role |
|---|---|
| `App.tsx` | All app state: items list, settings, scheduler (counting semaphore capped at `settings.concurrency`), engine banners, editors routing, batch bar, ZIP download (fflate), global Ctrl+V paste (files join the list; plain text becomes a note-N.md via `addNote`) |
| `types.ts` | `Item` (per-file state incl. `edit`, `edited`, `meta`, `outUrl`, `error` = ConvertError key, `pdfPassword`), `MediaEdit` (trim/volume/speed/rotate/mute/audioTrack), `Status` |
| `i18n.tsx` | Custom context. THREE dicts: zh / en / ja — **every new UI string needs all 3 keys** |
| `styles.css` | Design system "Cyberdeck": circuit-grid ground + scanlines, neon signal palette (`--paint-*`), `--glow`/`--accent-ink` tokens, synthwave hero, Chakra Petch display, IBM Plex Sans/Mono, light default theme. All editors' CSS lives here too |
| `components/Hero.tsx` | Home headline (tagline + title) only; folds away once files are listed |
| `components/TaskList.tsx` | Home "I want to…": every task from `lib/tasks` as a card, with a search box and a file-kind filter; picking one reports it to App (`pickTask`) |
| `components/DropZone.tsx` | Accepts every extension `detectKind` knows (`ACCEPT`), multi-file; optional blank-note link |
| `components/FileCard.tsx` | Thumbnail, chips, edit/convert/download/copy-to-clipboard buttons, the file's own options (override chips + the controls that apply to its conversion), a "more" menu (save as project, file details), warnings, ConvertError message |
| `components/SettingsPanel.tsx` | The drawer: every setting as the DEFAULT for new files, drawn section by section from `lib/settingFields`; only ever mounted inside the drawer |
| `components/SettingControl.tsx` | One setting as a form control (select / range / check) from its `SettingField` description — shared by the drawer and the file cards |
| `components/SizeViz.tsx` | The size pictures: `SizeCompare` (source vs result on one scale, size target as a tick), `StackBar` (one total split into coloured parts + a legend with the numbers), `Meter` (one quantity against its limit). Numbers come from `lib/sizeStats` |
| `components/FormatMatrix.tsx` | Supported-formats section + per-kind editor capability notes; output chips come from lib/formats, input chips are a short curated pick |
| `components/InstallPrompt.tsx` | PWA install card: `beforeinstallprompt` capture (Android/desktop) or iOS share-hint; 14-day dismiss (localStorage `morphkit-install-dismissed`); hidden when standalone |
| `components/InfoTip.tsx` | `(i)` glyph + fixed-position portal tooltip (`.tip-pop`) |
| `components/Overlay.tsx` | Portal-to-body modal backdrop — use for ALL modals (see invariant 17) |
| `components/ConfirmDialog.tsx` | Second step before an action the user must agree to: Studio project and asset deletes (`tone` danger, the default) and the OCR download (`tone` accent). Overlay + alertdialog, Cancel holds the focus, Escape cancels |
| `components/DualRange.tsx` | Generic dual-handle slider (time or frame ranges) |
| `components/FramePicker.tsx` | Video → frames: single-frame (image projects) or clip w/ fps (GIF projects). Inlines its own portal — keep in sync with Overlay |
| `vite-env.d.ts` | `vite/client` types (`import.meta.env`) |
| `gif-libs.d.ts` | Hand-written module types for gifuct-js / gifenc / upng-js, plus qpdf-wasm, the mammoth browser build, turndown-plugin-gfm and wawoff2 |

### Conversion libraries

| File | Role |
|---|---|
| `lib/formats.ts` | Kind detection (`image\|audio\|video\|pdf\|doc`), output lists — the single registry the UI derives from (image outs include `pdf`, `ico` and `txt` = OCR, `SLOW_IMAGE_OUTPUTS` queue like media; `VIDEO_OUTPUTS` = mp4/webm/gif + every audio output; `PDF_OUTPUTS` png/jpeg/webp/txt/docx/md/html/pdf; documents: `docTypeOf` → `DOC_OUTPUTS[type]` via `docOutputs(file)` — `outputsFor(kind, file)` needs the file for docs), `formatLabel` (jpeg → JPG), `ACCEPT` for file pickers, default targets (gif→apng, apng→gif, pdf→png, doc→first output), size thresholds, mime map |
| `lib/settings.ts` | Persisted Settings (localStorage `morphkit-settings`) — the defaults for new files |
| `lib/settingFields.ts` | The ONE description of every setting: label, control, hint and `applies(kind, target)` = the conversions it changes. `fieldsFor`, `effectiveSettings(defaults, item.opts)`, `withOption` (an override equal to the default is dropped), `activeOverrides`, `showValue`. Invariant 33 |
| `lib/tasks.ts` | "I want to…" registry: each `Task` is a preset over what the app already does — convert (target and/or per-file opts), editor (optionally a PDF export option), batch (merge), tool (QR). `suggestionsFor` (card chips), `taskFits`, `taskActive` (derived, nothing stored), `applyTask`, `filterTasks`. Invariant 34 |
| `lib/sizeStats.ts` | Arithmetic behind the size pictures: `sizeChange`, `compareBars`, `shares`, `sumBy`, `usedPct` (label; "<0.1" for tiny real use, never rounded up) |
| `lib/ocr.ts` | Text recognition (tesseract.js, lazy): `withOcr(langs, consent, fn)` hands `fn` a reader that starts the engine on its FIRST read — asking `consent` before a download (sizes in `ocrDownloadBytes`) — and closes it after; `imageToText`; `ocrLangs` (setting `auto` follows the UI language, English always added). Invariant 32 |
| `lib/errors.ts` | `ConvertError(key)`: a conversion failure the user can act on — thrown where the problem is detected (e.g. `joinPageText` in pdf.ts for PDFs without text); App stores `key` on `Item.error` and FileCard shows that i18n message instead of the generic `failed` |
| `lib/useBlobUrlOwner.ts` | Hook that owns blob: URLs held in state (App items, Studio thumbs): revokes the ones a commit no longer lists, the rest on unmount (invariant 2) |
| `lib/imageConvert.ts` | Static images via Canvas (`quality`, `maxDim` downscale-only); `fitToSize` squeezes an output under the image size target (quality first, then dimensions); `MIN_QUALITY` is the floor of every quality slider; `convertToIco` makes a multi-size favicon (`ICO_SIZES` up to the source size, `encodeIco` packs the PNGs) |
| `lib/animImage.ts` | GIF/APNG/static → RGBA frames (`decodeAnim`), `encodeAPNG` (upng-js, lossless alpha), `encodeGIFBlob(anim, matte\|null)` — `null` keeps binary alpha via gifenc `rgba4444` + `transparent+dispose:2`; `writeGifFrame` shared with GifEditor |
| `lib/ffmpegClient.ts` | ffmpeg.wasm **single-thread** core (no COOP/COEP → works on Pages), instance **pool** (shared core blob, one download), `buildArgs()` merges Settings + MediaEdit (trim `-ss/-t` before `-i`; vf/af chains) + metadata (`-map_metadata`, `-id3v2_version 3`, cover-art stream map) + bitrate mode (`rateOpts`: CBR `-b:a` vs VBR `-q:a`) + the video size target (`videoKbpsFor` → average bitrate in place of CRF, one lower retry when the output overshoots) + loudness normalisation (a measuring pass first, then one linear `loudnorm` gain, invariant 31) |
| `lib/metadata.ts` | Per-kind file info: dims/duration/EXIF-GPS (exifr)/bitrate estimate, PDF pages/author/encryption, document words/chars/lines/sheets/slides, QR codes found in images + `preview` (object URL for images — owned by `useBlobUrlOwner` once in state; dataURL frame-grab for video) |

### PDF

| File | Role |
|---|---|
| `lib/pdf.ts` | pdf.js (lazy + `?url` worker) `openPdf(bytes, password?)` (throws `PdfPasswordError` need/wrong)/`closePdf`/`renderPage`/`pdfInfo`/`readNotes`/`sniffEncrypted`; `getPlainBytes` (qpdf decrypt cache); conversions `pdfToImages` (multi-page → ZIP; render scale from settings), `pdfToText`, `rasterizePdf` (plan B); pdf-lib `buildPdf(PageSpec[], {watermark, encrypt, title, author})` — rotate/flip (embedPage), overlay PNG, sticky notes (strip + rewrite), watermark (canvas-rendered text or image), qpdf encrypt; `mergeToPdf(inputs w/ passwords)`, `imageToPdf`; user↔display coordinate helpers |
| `lib/pdfTools.ts` | Whole-document PDF tools (pdf-lib passed in, never imported statically): page numbers (`pageNumberLabel`, `pageNumberSpot` in DISPLAY fractions → `displayToUser`; Helvetica, ASCII formats), `squeezeImages` (re-encode RGB/grey 8-bit DCT images under `SQUEEZE_PRESETS`, keep any that would not shrink 10%), `inkShare` + `BLANK_INK_SHARE` for the blank-page finder |
| `lib/qpdf.ts` | qpdf-wasm (lazy, `qpdf.wasm?url`): `decryptPdf(bytes, pw)` / `encryptPdf(bytes, user, owner)` (AES-256) — fresh module per call, `QpdfError` carries the CLI log |
| `components/PdfEditor.tsx` | **PDF page editor** (modal + Studio `inline`): page-thumb grid + live preview over a `PPage[]` list (source = loaded PDF+index / image blob / blank) with NON-DESTRUCTIVE decorations — rotate, flipH/V, drawing `overlay` (nested ImageEditor → pixel-diff → transparent PNG in page user space; vectors untouched), sticky `notes` (real /Text annots, read back on load), `watermark` flag (doc-level text/image settings), undo/redo. Insert from PDFs+images, blank, dup/move/reverse/drag reorder. Export dialog: scope all/selected, split→ZIP, title/author, AES-256 encrypt, page numbers (numbered as the whole document even when split), image compression. Toolbar "find blank pages" selects pages by `inkShare` for the user to delete. Encrypted sources prompt via `PdfPasswordModal`; export decrypts with qpdf (`getPlainBytes`) else rasterizes |
| `components/PdfPasswordModal.tsx` | Overlay password prompt; caller verifies with pdf.js before it closes (`onSubmit → Promise<boolean>`, shake on wrong) — password lives in memory only |

### Documents

| File | Role |
|---|---|
| `lib/docs.ts` | Documents via ONE intermediate (sanitized HTML): read docx (mammoth UMD) / pptx (lib/pptx) / md (marked) / html / text / sheets (SheetJS) / json → `docToHtml`; write `htmlToMarkdown` (turndown+gfm, tables normalised), `htmlToDocx` (docx lib), `htmlToText`, `htmlToPdf` ('text' = vector text with embedded fonts, the default; 'raster' = canvas pages) and `htmlToPngs`, both laid out by lib/docPaint from the `htmlToBlocks` block model; sheets `readSheets`/`sheetsToXlsx`/`sheetsToCsv`/`sheetsToJson`/`rowsToMarkdown`; `countWords` (CJK-aware); entry `convertDoc(file, target, onProgress, opts)`; editor bridge `docEditSource`/`previewHtml`/`docSave` |
| `lib/docPaint.ts` | The document LAYOUT ENGINE behind PDF and PNG output: `renderBlocks(blocks, style, Painter)` (wrapping w/ CJK break points, headings/lists/quotes/code/tables/images/page breaks) + two painters — `renderCanvases` (raster pages) and `renderPdfBlob` (pdf-lib vector text w/ embedded Noto subsets via lib/cjkFont; throws offline → caller rasters) |
| `lib/cjkFont.ts` | On-demand Noto Sans TC/JP/KR for selectable-text PDFs: parse Google css2 `unicode-range` blocks, download ONLY the woff2 subsets the document's codepoints touch, wawoff2 (classic-script injected Emscripten) decompresses woff2→TTF for pdf-lib subsetting; `segment()` splits strings into per-subset runs |
| `lib/pptx.ts` | PPTX read WITHOUT a library (fflate unzip + DOMParser over slide OOXML: text runs w/ b/i, bullets by `lvl`, tables, embedded images → data URIs; slide order via presentation.xml rels; one `<section data-slide>` per slide with `<hr data-page-break>` between slides) · write via pptxgenjs, lazy (`blocksToPptx`: h1/h2 or `---`/pagebreak start a slide, bullets/tables/images placed) |
| `components/DocEditor.tsx` | Source textarea + live preview (split/source/preview) for md/html/json/text docs; DOCX and PPTX edit as Markdown and are rebuilt on save; sheets go to SheetEditor instead; Ctrl+S saves, Tab inserts |
| `components/SheetEditor.tsx` | Spreadsheet GRID editor (csv/tsv/xlsx/xls/ods): tab per sheet (add/delete/rename, workbooks only), cell inputs w/ Enter/Tab/arrow nav, insert/delete/move rows+cols, sort by column, undo, row 0 styled as the header, 300-row windows w/ "show more"; save = xlsx of all sheets (xls/ods come back as .xlsx) or csv/tsv text of the active sheet |

### Editors

| File | Role |
|---|---|
| `components/ImageEditor.tsx` | **Raster layer editor**: layer = canvas surface. Tools: pan/move/pen(3 brushes)/eraser/line/rect/ellipse/arrow/text/crop/wand/rectsel/lasso/fill — all paint into the active layer. Layer panel (add/dup/merge-down/delete/reorder/opacity/blend/lock/mask), pixel history, wheel zoom, marching-ants selections, bg layer |
| `components/ColorPicker.tsx` | Inline HSV picker (SV square + hue strip + hex), used by the ImageEditor layer panel, the PdfEditor watermark and the QrTool colours |
| `components/GifEditor.tsx` | ScreenToGif-style: decodes via `decodeAnim` (GIF **and** APNG), film strip thumbs, per-frame delete/dup/move/delay, dedupe (32px signature merge), draggable caption layers (relative x/y), flatten toggle + matte, output GIF or APNG |
| `components/MediaEditor.tsx` | A/V trim (DualRange + playhead buttons), volume/speed/rotate, mute or replace the audio track → saved as `Item.edit`, applied at ffmpeg time |

### QR codes

| File | Role |
|---|---|
| `lib/qr.ts` | QR encode (node-qrcode) / decode (jsQR), both lazy: `qrToCanvas`/`qrToSvg` (QrStyle: colours, size, quiet zone, ECC, centre logo), `decodeQr` downsamples then retries inverted/contrast-boosted, `decodeFrame` (camera loop), `payloads` builders (wifi/vcard/mail → mailto:) + `classifyPayload`, `DEFAULT_QR` |
| `components/QrTool.tsx` | QR modal, two tabs — MAKE: template (text/URL/Wi-Fi/vCard/mail) → styled live preview, download PNG/SVG, copy, push PNG into the converter list; READ: drop/pick/paste image or camera scan (getUserMedia + `decodeFrame`) → decoded payload w/ type-aware actions. Opened from topbar `.qr-btn`, the home task list (task `qr`, the only way on phones), or a FileCard QR chip |

### Studio

| File | Role |
|---|---|
| `components/Studio.tsx` | **Typed projects** — shown to users as 專案 / Projects, the code keeps the name Studio (App `mode==='studio'`): launcher (first visit explains what a project is, later the list comes first with a one-line storage note and a backup mark per card; six use cards start a project — type is immutable; deleting moves a project to a 30-day trash (restore / delete for good); zip import/export w/ id remap, export stamps the backup), workspace routing for the 6 types (audio→Mixer, image→inline ImageEditor w/ persisted layers, gif→inline GifEditor, video→VideoWorkspace, pdf→inline PdfEditor, text→inline DocEditor), primary-asset pickers (◎), blank canvas, new-project-from-asset |
| `components/VideoWorkspace.tsx` | Video project: preview + trim (DualRange) + embedded Mixer; export = renderMixWav → `muxVideo` → MP4 |
| `components/Mixer.tsx` | Multi-track timeline: sticky track heads (name/M/S/gain), draggable+edge-trimmable clips w/ waveform canvas, ruler seek, playhead rAF, split-at-playhead, mic recording (MediaRecorder→asset→new track), WAV export |
| `lib/studioTypes.ts` | `ProjectType` (6 types), `Clip`/`Track`/`MixerDoc`/`ImageDoc`/`VideoDoc`/`ProjectRec` (+ `deletedAt`, `exportedAt`)/`AssetRec`, `empty*` factories, trash rules (`TRASH_DAYS`, `isTrashed`, `trashDaysLeft`, `trashExpired`), `backupState`, `INLINE_SAVE_EVT`, `uid()` |
| `lib/idb.ts` | IndexedDB `morphkit-studio`: `projects` store + `assets` store (index `projectId`) |
| `lib/audioEngine.ts` | AudioBuffer decode cache (assetId-keyed), `playMix` live graph (solo/mute logic), `renderMixWav` OfflineAudioContext, `peaks` for waveforms |
| `lib/wav.ts` | AudioBuffer → 16-bit PCM WAV |
| `lib/useSplitter.ts` | Draggable panel-size hook (localStorage-persisted, dblclick reset) behind every `.split-gutter`/`.ie-gutter` |

## Invariants & gotchas (violating these causes regressions)

1. **i18n**: `t(key)` falls back to en → missing keys render the raw key. Add zh+en+ja together.
2. **Object URLs**: blob: URLs kept in state (`Item.outUrl`, `Item.meta.preview`, Studio launcher thumbs) are owned by `useBlobUrlOwner` — just drop or replace them in state; the hook revokes whatever is gone after React commits. Never revoke one of these by hand (it may still be on screen). Transient URLs that never reach state (download links, probes) are still revoked by their creator.
3. **ffmpeg pool**: one job per instance; app-level semaphore caps pool size. Never call `ff.exec` concurrently on one instance.
4. **GIF transparency**: plain quantize turns alpha into black. Keep alpha ⇒ `rgba4444` format + `transparent: true` + `dispose: 2` (see `writeGifFrame`).
5. **Text tool focus bug**: canvas `pointerdown` must `preventDefault()` or it blurs the floating text input instantly.
6. **`.tool-btn.active:hover`** needs explicit `color: var(--bg)` — the generic hover rule otherwise paints ink-on-ink.
7. **Editor canvases** are full-resolution; zoom is CSS width only. Pointer→canvas mapping divides by `getBoundingClientRect`.
8. **ImageEditor history**: each entry (`HistEntry`) snapshots every layer's pixels plus the base `Blob` (shared by reference); geometry ops (crop/rotate/flip/resize) go through `transformLayers` + `swapBase`. The full layer rules are in 18.
9. Build output goes nowhere near the repo: `dist/` is gitignored.
10. Bullet-proof rule: after edits run `npx tsc` — the project is strict-mode clean.
11. **Studio persistence**: `savePatch` debounces the IndexedDB write by 500 ms; clips reference assets by id — deleting an asset must strip its clips AND `dropAssetBuffer`.
12. **AudioContext** is created lazily (user gesture) — never at module load. Buffers must be decoded (cache warm) before `playMix`/`renderMixWav`; Studio warms the cache on project load.
13. **MediaEdit trim preview**: never seek-back on reaching trim end (causes visible shake); trim handles scrub `currentTime` instead.
14. **Typed projects**: `ProjectRec.type` is set at creation and immutable; legacy records without `type` are 'audio'. `savePatch` updates `curRef` synchronously — required for rapid patch bursts (trim drags, `onLayersChange`). The async init load MERGES into `projects` and only fills a null `curId` — clobbering either wipes a project created before the IndexedDB read resolves (savePatch then no-ops on a null curRef and the record never persists).
15. **ImageEditor inline mode**: `initialLayers` is consumed once at mount, so the inline editor is keyed by its base asset id. Pseudo-Items passed to inline editors MUST be memoized or the init effect loops.
16. **muxVideo**: audio timeline aligns to the TRIMMED video start; wav is rendered by OfflineAudioContext first, then mapped `-map 0:v -map 1:a -shortest`.
17. **Modals MUST portal to `<body>`** (`components/Overlay.tsx`, or `createPortal` directly). Any ancestor transform/filter makes itself the containing block for `position:fixed`, which clips the backdrop. Keyframe endings should also be `transform: none` for the same reason — AND transform-animating entrances must fill `backwards`, never `both`/`forwards`: a FINISHED fill keeps a transform on the element (Chrome reports an identity matrix even for an end frame of none), which overrides the element's own transform (bottom-sheet slides silently freeze — animations beat inline styles) and makes it the containing block for fixed descendants. Bit the Studio assets sheet via rise/panelIn.
18. **Layer model is RASTER**: a `Layer` IS a canvas (`pixRef: Map<id, HTMLCanvasElement>`, persisted as `src` dataURL). Every tool paints into the active layer; there are no sub-objects. Rendering composites each layer through a scratch canvas (mask via `destination-in`, then alpha+blend). Geometry ops (crop/rotate/resize) must run `transformLayers` so every layer canvas follows the base. History snapshots ALL layer pixels (cap 14) — keep it that way or undo desyncs.
    **Eraser** = `destination-out` stroke into the active layer. Because the base is composited
    UNDER every layer, erasing a blank active layer first *promotes* the base into a bottom layer
    (`promoteBase`) and swaps in a pre-built transparent base — this MUST stay synchronous
    (an async base swap can land after an undo) and only fires when the active layer is empty
    (a layer with pixels erases its own pixels, like any raster editor). The selection
    「clear」 path (`applyToSelection`) MUST do the same promotion — the wand usually selects
    base pixels, and destination-out into a blank layer silently deletes nothing.
    **Move tool** keeps a session-only per-layer store (`moveStoreRef`: true content + integer
    offset) so pixels dragged off-canvas survive later moves; the layer canvas stays the
    canvas-clipped view (export/copy unchanged). Every OTHER pixel edit, undo, or geometry op
    must invalidate that store or moves resurrect stale pixels.
19. **Metadata**: tags need `-map_metadata 0`; MP3 additionally needs `-id3v2_version 3` (v2.4 breaks Windows/older players) + `-write_id3v1 1`. Cover art is a single-frame video stream — it requires an explicit `-map 0:a -map 0:v:0? -c:v copy -disposition:v:0 attached_pic` and must NOT be attempted for WAV/OGG (unplayable output), when trimming (stream desync), or from a VIDEO source (its first video stream is the film, not a cover — an iTunes-tagged video still contains `covr`). `convertMedia` retries once without art if the mapped run fails.
20. **Audio bitrate mode**: `rateOpts` owns the CBR/VBR split. `-q:a` scales are
    encoder-specific and point opposite ways — libmp3lame 0(best)…9, libvorbis
    0…10(best) — so `audioQuality` is mirrored for vorbis. Native AAC VBR is
    experimental, so m4a always uses `-b:a`.
21. **Cross-type imports**: asset-panel ↧ routes by project type (Studio `importAssetToEditor`). Image layers persist as full-resolution PNG dataURLs in `Layer.src` (written by `commitPixels`, saved under `ImageDoc.layers`). GIF appends contain-fit imported frames to its own canvas size. GIF→video conversion is capped at 15 MB.
22. **Mobile layer** (end of styles.css; details in `docs/claude/styles.md`): the page must NEVER
    scroll horizontally — html/body carry `overflow-x: clip` + `overscroll-behavior-x: none`
    (a sideways pan on mobile triggers the browser's back-swipe); viewport-wide decorations get
    clipped by their container (`.hero` overflow:hidden). Breakpoints 640 (phone: modal editors become full-width sheets, inputs ≥16px for iOS focus-zoom) / 760 (studio stacks AND switches to auto height so the page scrolls; really the app-mode family of 24). Hover-only affordances need a `@media (hover:none)` fallback; new drag surfaces need `touch-action:none` + `setPointerCapture`; `.trk-head`/`.lane` CSS must mirror `HEAD_W`/`LANE_H` in Mixer.tsx; `.ed-options` stays a nowrap fixed-height scroller by design; new `100vh` layout values need a dvh override in the `@supports (height:100dvh)` block.
23. **Mobile image editor** (≤720, **≤540px tall**, or coarse-pointer ≤920 — landscape phones, squat PWA windows and touch tablets get the same treatment; the OR-condition media queries are self-sufficient: they reset overlay padding + editor max-width/radius because the generic ≤640 rules do not apply at 844×390): layers panel becomes a fixed bottom sheet (`.layers-panel.open`, `panelOpen` state + `.lp-fab` toggle + `.lp-scrim` in ImageEditor.tsx). ≤640 the modal editor with `.ie-layout` is a **100dvh paint-app GRID** — canvas owns the screen, `.ed-toolbar` becomes a 50px vertical scrolling left rail, `.ed-options` a thin bottom strip, foot last (`.kbd-hints` hidden). The inline editor gets the same rail grid ≤760, where the rail is `position:absolute; inset:0` inside its own grid area (the editor is `position:relative`) — its ~900px content MUST stay out of track sizing or the height:auto studio chain grows the page to fit (a vh `max-height` cap did that job before but left the rail border ending mid-air); both app rails carry a bottom mask-image fade + 26px bottom padding as the scroll hint. The inline `.ie-viewport` is a flex box with `.ie-inner{margin:auto}` so the canvas centers instead of hugging the top-left (same trick as the modal). Focus mode adds `env(safe-area-inset-top)` to `.studio.st-focus` — the topbar that normally carries the notch padding is hidden there — and EVERY project type goes FULL-BLEED in focus: app gutter zeroed, `.studio.st-focus` is exactly 100dvh (a real `height`, not min-height — WebKit doesn't stretch flex children from min-height alone), inline editors shed their card chrome, and the bottom-most surface (image options strip / editor body / mixer / vw) carries `env(safe-area-inset-bottom)` itself so nothing shows under it. Non-grid inline editors get `overflow-y:auto` (the studio no longer grows). The base `.ie-layout` is `align-items:start` — the modal override needs `stretch` or the viewport collapses.
24. **App-mode media condition**: the stacked studio, focus mode, and the editor app layouts share
    ONE breakpoint family — `(max-width:760px), (max-height:540px), (pointer:coarse) and (max-width:920px)`
    (`APP_MQ` in Studio.tsx MUST mirror the styles.css stacked-studio block; it drives auto-focus +
    the assets-panel default). Single-column workspace tracks are `minmax(0,1fr)`, never bare `1fr` —
    a wide workspace's min-content (mixer lanes, pdf toolbar) blows a bare `1fr` track past the screen
    edge — and the `.st-body` single-column rule must repeat `.st-body:has(.st-assets.collapsed)`
    (that selector outranks a bare class, so the desktop max-content collapse template would win on
    phones, where assets start collapsed) AND pin rows to `auto minmax(0,1fr)` (default auto rows +
    align-content stretch split the leftover height with the fit-content assets row → dead band). In focus mode `.studio` reclaims the hidden chrome's height;
    the assets toggle (`.st-fab` + badge) and the `.st-save` proxy live in the TOP `.st-bar` (nothing
    floats over the bottom) — `.st-save` dispatches `INLINE_SAVE_EVT` (lib/studioTypes) and every
    inline editor (Image/Gif/Pdf/Doc) listens while inline; the editors' `.ed-foot` is hidden in
    focus but stays in the DOM so `:has()` mirrors mounted/disabled state onto `.st-save`.
25. **PDF**: `Kind` includes `'pdf'` — every `kind` switch needs a pdf arm (FileCard icons/labels,
    `extractMeta`, `runConvert`, editor routing, Studio `TYPE_META`/`primaryAsset`/`pseudoItem`).
    PDFs are a Studio type (`pdfAssetId`; inline PdfEditor writes back via `replaceAssetBlob` like
    GIF, split-to-ZIP is hidden inline). pdf.js, pdf-lib and qpdf-wasm are lazy `import()`s — never
    import them statically or the main bundle grows ~3 MB. `PDFDocumentProxy` has no `destroy()`: use
    `closePdf(doc)` (the loading task owns teardown). PDF→raster of a multi-page doc yields a ZIP
    (`outName` swaps to `.zip`). Image→PDF and all PDF jobs go through the app semaphore, not the
    instant image path. PdfEditor renders the nested ImageEditor OUTSIDE its overlay div — both
    portal to body and React bubbles portal clicks to the React parent (the backdrop's onClose).
    **Encryption**: pdf.js reads encrypted files given `password`; pdf-lib cannot — export goes
    through `getPlainBytes` (qpdf-wasm decrypt, plan A) and falls back to `rasterizePdf` (plan B).
    Passwords live on `Item.pdfPassword` / PdfEditor `SrcDoc` only — NEVER in localStorage/IndexedDB.
    `runConvert` catching `PdfPasswordError` resets the item and opens the prompt (`pwFor`).
    **Coordinate spaces**: notes/overlays are stored in page USER space (unrotated media box) so
    later rotate/flip keeps them glued to content; display ↔ user via `userToDisplay`/
    `displayToUserCanvas` with `totalRot = intrinsic + rotate` and flips applied in display space.
    Draw-on-page diffs the ImageEditor result against the UNDECORATED render (`decorate:false`);
    a size change (crop/resize) is the one case that still rasterizes the page.
26. **QR**: `imageMeta` decodes QR codes on every non-GIF image (<25 MB) → `meta.qr` chip; jsQR
    needs downscale+invert retries for dark-UI screenshots (see `decodeQr`). Camera scanning must
    stop tracks on close/unmount. qrcode's `toCanvas` light colour '#0000' = transparent bg.
27. **Documents**: `Kind 'doc'` outputs depend on the SOURCE sub-type — always call `outputsFor(kind, file)` /
    `defaultTarget` with the file. Every document conversion goes through sanitized HTML
    (`docToHtml` → `htmlTo*`); spreadsheets/JSON take a data fast path. mammoth MUST be imported as
    `mammoth/mammoth.browser.js` (the node entry pulls fs/path). PDF output has two painters in
    lib/docPaint — selectable vector text (default, invariant 28) and raster pages (fallback, or when
    `docPdfText` is off: CJK still renders, text is not selectable — say so in UI copy); PNG output is
    always raster. turndown-gfm only converts tables with a header row and chokes on `<p>` inside cells
    → `normalizeTablesForMd` runs before every html→md. Only text-ish docs (`isTextDoc`) become Studio
    projects (invariant 29): `openAsProject` bails on the others and FileCard hides their button. Every
    doc library is a lazy `import()` (mammoth, xlsx, marked, turndown + gfm, docx, pptxgenjs).
28. **Doc→PDF text mode** (`settings.docPdfText`, default ON): pdf-lib needs raw sfnt tables, so
    Google's woff2 subsets are decompressed by wawoff2 loaded as a CLASSIC SCRIPT via
    `?url` + <script> injection — bundling its Emscripten glue (Vite CJS transform) breaks env
    detection and init hangs forever; poll for `Module.decompress` instead of trusting
    `onRuntimeInitialized`. fontkit also cannot re-encode subsets straight from woff2 (composite
    glyphs corrupt → pdf.js "Invalid font data"). Any failure falls back to the raster painter
    automatically. Text copied from these PDFs may carry extra spaces between CJK glyphs that sit
    in different subset files (separate draw segments) — known cosmetic limit.
29. **PPTX**: read side is hand-rolled OOXML (no lib) — match elements by `localName` (never
    prefix), resolve every part through its .rels, and keep `<hr data-page-break>` as the slide
    boundary: it round-trips as `---` through Markdown, the paginator/docx writer treat it as a
    page break (attribute present) vs a rule (bare hr), and `blocksToPptx` starts a new slide on
    h1/h2 OR hr. Sheets route to SheetEditor (docTypeOf === 'sheet'), other docs to DocEditor;
    plain .txt edits in Markdown mode but saves verbatim bytes. Text-ish docs (`isTextDoc`:
    md/txt/html/json) can open as Studio TEXT projects (`textAssetId` + inline DocEditor writing
    back via `replaceAssetBlob`); sheets/pptx cannot. Ctrl+V of plain TEXT (no files)
    creates a note-N.md doc item and opens the editor (`addNote`) — inputs/textareas excluded.
30. **PWA**: `public/sw.js` caches by `VERSION` const — bump it whenever caching semantics change or stale shells linger; ffmpeg core (unpkg) + Google Fonts are cached cross-origin by hostname allowlist. SW registers PROD-only (dev HMR fights a cached shell). Theme is 3-state (auto=follow OS, default / light / dark — `useTheme` in App.tsx; auto listens to `prefers-color-scheme` live). `theme-color` meta hexes live in TWO places (index.html inline script for first paint, `THEME_COLORS` in App.tsx) and must match `--bg` light/dark. ≤640 the bottom `.m-tabbar` (home / projects / settings) owns mode switching (topbar `.studio-toggle` hides) and `.app` needs its padding-bottom clearance.
31. **Loudness** (`settings.audioLoudness`, LUFS, 0 = off): two passes. `loudnessProbeArgs` measures
    with the SAME trim as the encode (the replacement track, untrimmed, when the sound comes from
    input 2), `parseLoudness` reads loudnorm's JSON block from the log, `loudnormFor` builds the
    linear second pass. loudnorm outputs 192 kHz with NO channel layout; in ffmpeg 5.1 (the browser
    core) AAC then fails with "Cannot select channel layout", so the chain ends with
    `aformat=sample_rates=…:channel_layouts=…` from the source banner (`audioFormatInLog`). The
    native ffmpeg 7 does not fail this way — check loudness changes in the browser. It runs first in
    `afChain` (the card's volume still moves the normalised level); silence (-inf) is left alone; a
    video without sound skips it, an audio target from one still throws `noAudioTrack`.
32. **OCR** (lib/ocr.ts): NOTHING is fetched from cdn.jsdelivr.net before the user agrees. Every OCR
    path goes through `withOcr` with App's `askOcr` (one ConfirmDialog shared by every job waiting on the
    same download; no → `ConvertError('ocrDeclined')`). Downloaded languages are remembered in
    localStorage `morphkit-ocr-langs` (tesseract.js keeps the data itself in IndexedDB); the sizes in the
    dialog are `ENGINE_BYTES`/`LANG_BYTES`, measured for `OCR_ENGINE_VERSION` — tests/ocr.test.ts fails
    when the installed tesseract.js moves on, so re-measure then. PDFs read the text layer first and
    OCR only pages without one (`pdfToText`'s `readScan`), so a normal PDF never asks. Images are
    flattened onto white before reading (Tesseract sees transparent as black). Chinese/Japanese set
    `preserve_interword_spaces` or every character comes out space-separated.
33. **Settings are defaults; a file may override them** (`Item.opts: Partial<Settings>`). A conversion
    reads `effectiveSettings(settingsRef.current, item.opts)` — inside `runConvert` never read
    `settingsRef.current` directly (only the worker count is app-wide). A field's `applies(kind, target)`
    in lib/settingFields MUST say the same as the conversion code that reads the setting (it uses the
    same constants: `AUDIO_OUTPUTS`, `AV_TARGETS`, `ART_CAPABLE`, `RASTER_OUTPUTS`, `PDF_TEXT_OUTPUTS`),
    or a card offers an option that does nothing. Changing an option of a finished file sends it back
    to ready (`staleResult`), like changing the target. Overrides live in memory with the item; the
    drawer's values are never changed from a card.
34. **Tasks are presets, never new behaviour** (lib/tasks.ts). A convert task only sets `Item.target`
    and `Item.opts` through `applyTask`; an editor task only opens the existing editor (PDF: with
    `exportPreset`, applied ONCE per mount, when the pages are loaded); a batch task only points at
    the batch bar. So everything a task does can also be done by hand, and a card shows it as an
    ordinary format + option chips. Whether a task is "on" is derived (`taskActive`) — do not store
    the chosen task on the item. A task picked on the home page (`preset`) applies to the files added
    next that it fits (`taskFits`: same kind AND the output exists for that file); a convert or editor
    preset clears after one add, a batch preset stays until merged or cancelled. tests/tasks.test.tsx
    checks every task against `outputsFor` and `fieldsFor`, and that its two strings (`task_<id>`,
    `task_<id>_d`) exist in all three languages. New user-facing job → one entry + six strings.
35. **Deleting a project = `deletedAt`** (the record and its assets stay in IndexedDB). `listProjects()`
    returns trashed records too — every reader must filter with `isTrashed` (Studio init splits them,
    App counts live ones only). Only three things call `idbDeleteProject`: the trash's "delete for good",
    "empty the trash" (both behind ConfirmDialog) and the automatic purge at Studio init of records past
    `TRASH_DAYS`. `removeProject` writes the LATEST in-memory state (`curRef`) with `deletedAt` after
    clearing the debounced save, so an unsaved rename survives into the trash and the pending save
    cannot write the project back live. `exportedAt` is stamped by `exportProjectZip` through
    `savePatch(patch, false)` — `touch: false` leaves `updatedAt` alone, or the backup would read as
    stale the moment it is made. The import must restore everything the export wrote (`...meta.imageDoc`).

## Design language ("Cyberdeck")

Neon-tech aesthetic, light default ("day lab" — cool white + electric indigo; dark = "night
grid" — deep-space navy `#0a0e1c`, NEVER pure black: surfaces must step up visibly bg→raised
→sunken and lines run brighter for contrast). Circuit-grid body background (`--weave` graph
lines) + CRT scanline overlay (`body::after`). Signal palette `--paint-red/blue/yellow/green/
violet` (token names kept from the pigment era) used semantically: image=lime, audio=cyan,
video=magenta, gif=amber (type badges, mx-cards, feat chips, mixer clips cycle it).
`--accent-ink` = text colour on accent surfaces (dark theme accent is light cyan → dark text).
`--glow` = standard neon box-shadow for hover/focus/selection. Fancy layer: synthwave
perspective grid + drifting orbs in hero (`.hero::before/::after`), RGB-split glitch on
`.hero-accent` (needs `data-text` attr), terminal cursor tagline, button sheen sweep
(`.btn::after`), progress-bar travelling sheen (`barSheen`), HUD corner brackets on dropzone.
Display font Chakra Petch (CJK falls back to Noto Sans); mono data labels stay. Sharp radii
(6/10px), no rotations, no hand-drawn shapes. `prefers-reduced-motion` kills all of it (last
block in styles.css). Dark theme via `:root[data-theme]` variables only.
The README cover (`docs/images/cover.html` → `cover.webp`) uses the dark tokens; re-render it when
the palette or the mark changes.

## Conventions

- New converter feature → param in `settings.ts` + one entry in `lib/settingFields.ts` (the drawer and the cards draw themselves from it) + wire into `buildArgs` (recipe: `/add-setting`).
- New editor capability → keep ImageEditor raster (paint into the active layer, invariant 18) and GifEditor frame-based; bake only geometry.
- Structural change to a mapped file → update its `docs/claude/*.md` map in the same commit.
- A size, a share or a countdown shown to the user gets a picture next to the number (`SizeViz`): the number stays as text, the bar is `role="img"` with the same facts in its label, colours come from tokens, and a bar never claims more than the number (`usedPct`).
- New thing people can do → add it to `lib/tasks.ts` so the home page and the file cards can offer it (invariant 34).
- Bug fix → add a regression test in `tests/` next to the closest existing one.
- Anything that deletes without an undo (IndexedDB records, user files) goes through `ConfirmDialog`; say in the message what goes with it.
- Commits: conventional-ish (`feat:`, `fix:`, `design:`, `docs:`), one logical change each, always build and test first.
