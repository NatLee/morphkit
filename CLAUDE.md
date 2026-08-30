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
npm run dev      # dev server
npm run build    # tsc && vite build  (MUST pass before committing)
```

Sandbox note: the mounted FS may refuse to delete `dist/`; build with
`npx vite build --outDir /tmp/morphkit-dist --emptyOutDir` to verify instead.

## Context economy — read maps, not source

Per-subsystem maps live in `docs/claude/`. **Read the map INSTEAD of the big source file**
for orientation; then grep the exact names it gives you. Do NOT `@import` them here
(imports would load every session). When you change a mapped file's structure, spend the
one or two lines to update its map.

| Map | Read before opening |
|---|---|
| `docs/claude/app-shell.md` | App.tsx, Hero, DropZone, FileCard, SettingsPanel, FormatMatrix, DualRange, Overlay, FramePicker, InfoTip |
| `docs/claude/editors.md` | ImageEditor.tsx (1.7k lines), GifEditor.tsx, PdfEditor.tsx, PdfPasswordModal.tsx, DocEditor.tsx |
| `docs/claude/studio.md` | Studio.tsx (1.1k), Mixer.tsx, VideoWorkspace.tsx, MediaEditor.tsx |
| `docs/claude/libs.md` | every lib/*.ts, types.ts, i18n.tsx mechanics |
| `docs/claude/styles.md` | styles.css section index + responsive/mobile architecture |

Project skills: `/add-setting` (new converter param), `/add-format` (new format).
`.claude/settings.json` pre-approves `npx tsc`, builds, and read-only git commands.
Map maintenance is ENFORCED: `npm run check:context` (also a Stop hook + a CI job)
fails on stale map tokens, unmapped src files, HEAD_W↔CSS desync, and i18n key or
`{placeholder}` gaps. Rules, triggers, and rationale: `docs/claude/README.md`.

## File map (src/)

| File | Role |
|---|---|
| `App.tsx` | All app state: items list, settings, scheduler (counting semaphore capped at `settings.concurrency`), engine banners, editors routing, batch bar, ZIP download (fflate), global Ctrl+V paste-file |
| `types.ts` | `Item` (per-file state incl. `edit`, `edited`, `meta`, `outUrl`), `MediaEdit` (trim/volume/speed/rotate), `Status` |
| `i18n.tsx` | Custom context. THREE dicts: zh / en / ja — **every new UI string needs all 3 keys** |
| `styles.css` | Design system "Cyberdeck": circuit-grid ground + scanlines, neon signal palette (`--paint-*`), `--glow`/`--accent-ink` tokens, synthwave hero, Chakra Petch display, IBM Plex Sans/Mono, light default theme. All editors' CSS lives here too |
| `lib/formats.ts` | Kind detection (`image\|audio\|video\|pdf\|doc`), output lists (image outs include `pdf`; `PDF_OUTPUTS` png/jpeg/webp/txt/docx/md/html/pdf; documents: `docTypeOf` → `docOutputs(file)` — `outputsFor(kind, file)` needs the file for docs), default targets (gif→apng, apng→gif, pdf→png, doc→first output), size thresholds, mime map |
| `lib/imageConvert.ts` | Static images via Canvas (`quality`, `maxDim` downscale-only) |
| `lib/ffmpegClient.ts` | ffmpeg.wasm **single-thread** core (no COOP/COEP → works on Pages), instance **pool** (shared core blob, one download), `buildArgs()` merges Settings + MediaEdit (trim `-ss/-t` before `-i`; vf/af chains) + metadata (`-map_metadata`, `-id3v2_version 3`, cover-art stream map) + bitrate mode (`rateOpts`: CBR `-b:a` vs VBR `-q:a`) |
| `lib/animImage.ts` | GIF/APNG/static → RGBA frames (`decodeAnim`), `encodeAPNG` (upng-js, lossless alpha), `encodeGIFBlob(anim, matte\|null)` — `null` keeps binary alpha via gifenc `rgba4444` + `transparent+dispose:2`; `writeGifFrame` shared with GifEditor |
| `lib/metadata.ts` | Per-kind file info: dims/duration/EXIF-GPS (exifr)/bitrate estimate + `preview` (object URL for images — revoke on remove!, dataURL frame-grab for video) |
| `lib/settings.ts` | Persisted Settings (localStorage `morphkit-settings`) |
| `components/Hero.tsx` | Tagline + title + feature chips only (format pickers were removed on purpose — they misled users) |
| `components/DropZone.tsx` | Accepts image/audio/video/pdf/document extensions, multi-file |
| `components/InstallPrompt.tsx` | PWA install card: `beforeinstallprompt` capture (Android/desktop) or iOS share-hint; 14-day dismiss (localStorage `morphkit-install-dismissed`); hidden when standalone |
| `vite-env.d.ts` | `vite/client` types (`import.meta.env`) |
| `components/FileCard.tsx` | Thumbnail, chips, edit/convert/download/copy-to-clipboard buttons, details panel, warnings |
| `components/MediaEditor.tsx` | A/V trim (DualRange + playhead buttons), volume/speed/rotate → saved as `Item.edit`, applied at ffmpeg time |
| `components/ImageEditor.tsx` | **Raster layer editor**: layer = canvas surface. Tools: pan/move/pen(3 brushes)/eraser/line/rect/ellipse/arrow/text/crop/wand/rectsel/lasso/fill — all paint into the active layer. Layer panel (add/dup/merge-down/delete/reorder/opacity/blend/lock/mask), pixel history, wheel zoom, marching-ants selections, bg layer |
| `components/PdfEditor.tsx` | **PDF page editor** (modal + Studio `inline`): page-thumb grid + live preview over a `PPage[]` list (source = loaded PDF+index / image blob / blank) with NON-DESTRUCTIVE decorations — rotate, flipH/V, drawing `overlay` (nested ImageEditor → pixel-diff → transparent PNG in page user space; vectors untouched), sticky `notes` (real /Text annots, read back on load), `watermark` flag (doc-level text/image settings), undo/redo. Insert from PDFs+images, blank, dup/move/reverse/drag reorder. Export dialog: scope all/selected, split→ZIP, title/author, AES-256 encrypt. Encrypted sources prompt via `PdfPasswordModal`; export decrypts with qpdf (`getPlainBytes`) else rasterizes |
| `components/PdfPasswordModal.tsx` | Overlay password prompt; caller verifies with pdf.js before it closes (`onSubmit → Promise<boolean>`, shake on wrong) — password lives in memory only |
| `lib/pdf.ts` | pdf.js (lazy + `?url` worker) `openPdf(bytes, password?)` (throws `PdfPasswordError` need/wrong)/`closePdf`/`renderPage`/`pdfInfo`/`readNotes`/`sniffEncrypted`; `getPlainBytes` (qpdf decrypt cache); conversions `pdfToImages` (multi-page → ZIP), `pdfToText`, `rasterizePdf` (plan B); pdf-lib `buildPdf(PageSpec[], {watermark, encrypt, title, author})` — rotate/flip (embedPage), overlay PNG, sticky notes (strip + rewrite), watermark (canvas-rendered text or image), qpdf encrypt; `mergeToPdf(inputs w/ passwords)`, `imageToPdf`; user↔display coordinate helpers |
| `lib/docs.ts` | Documents via ONE intermediate (sanitized HTML): read docx (mammoth UMD) / md (marked) / html / text / sheets (SheetJS) / json → `docToHtml`; write `htmlToMarkdown` (turndown+gfm, tables normalised), `htmlToDocx` (docx lib), `htmlToText`, `htmlToPdf`/`htmlToPngs` via the canvas paginator `layoutHtml` (`htmlToBlocks` block model; rasterized A4 pages — CJK-safe, text not selectable); sheets `readSheets`/`sheetsToXlsx`/`sheetsToCsv`/`sheetsToJson`/`rowsToMarkdown`; entry `convertDoc(file, target)`; editor bridge `docEditSource`/`previewHtml`/`docSave` |
| `lib/pptx.ts` | PPTX: read via fflate + DOMParser (no library) → sanitized-HTML blocks, one `<section data-slide>` per slide, so every doc target works on presentations; write via pptxgenjs (lazy) splitting blocks into slides on h1/h2 |
| `lib/pptx.ts` | PPTX read WITHOUT a library (fflate unzip + DOMParser over slide OOXML: text runs w/ b/i, bullets by `lvl`, tables, embedded images → data URIs; slide order via presentation.xml rels; `<hr data-page-break>` between slides) · write via pptxgenjs (`blocksToPptx`: h1/h2 or `---`/pagebreak start a slide, bullets/tables/images placed) |
| `lib/qr.ts` | QR encode (node-qrcode: canvas/SVG, colours, quiet zone, ECC, centre logo) + decode (jsQR w/ downscale/invert/contrast retries), `payloads` builders (wifi/vcard/mailto), `classifyPayload` |
| `components/QrTool.tsx` | QR modal, 2 tabs: MAKE (url/text/wifi/vcard/mail templates → live preview, PNG/SVG download, copy, add-to-list) + READ (drop/pick/paste image, camera scan via getUserMedia+decodeFrame, type-aware actions). Opened from topbar `.qr-btn`, the 4-tab phone bar, or a FileCard QR chip |
| `components/SheetEditor.tsx` | Spreadsheet GRID editor (csv/tsv/xlsx/xls/ods): tab per sheet (add/delete/rename), cell inputs w/ Enter/Tab/arrow nav, insert/delete/move rows+cols, sort by column, undo, 300-row windows; save rebuilds xlsx (all sheets) or csv text |
| `lib/pptx.ts` | PPTX read WITHOUT a library (fflate unzip + DOMParser over slide OOXML: text runs w/ b/i, bullets by `lvl`, tables, embedded images → data URIs; slide order via presentation.xml rels; `<hr data-page-break>` between slides) · write via pptxgenjs (`blocksToPptx`: h1/h2 or `---`/pagebreak start a slide, bullets/tables/images placed) |
| `lib/qr.ts` | QR encode (node-qrcode: canvas/SVG, colours, quiet zone, ECC, centre logo) + decode (jsQR w/ downscale/invert/contrast retries), `payloads` builders (wifi/vcard/mailto), `classifyPayload` |
| `components/QrTool.tsx` | QR modal, 2 tabs: MAKE (url/text/wifi/vcard/mail templates → live preview, PNG/SVG download, copy, add-to-list) + READ (drop/pick/paste image, camera scan via getUserMedia+decodeFrame, type-aware actions). Opened from topbar `.qr-btn`, the 4-tab phone bar, or a FileCard QR chip |
| `components/SheetEditor.tsx` | Spreadsheet GRID editor (csv/tsv/xlsx/xls/ods): tab per sheet (add/delete/rename), cell inputs w/ Enter/Tab/arrow nav, insert/delete/move rows+cols, sort by column, undo, 300-row windows; save rebuilds xlsx (all sheets) or csv text |
| `lib/docPaint.ts` | The document LAYOUT ENGINE behind both PDF outputs: `renderBlocks(blocks, style, Painter)` (wrapping w/ CJK break points, headings/lists/quotes/code/tables/images/page breaks) + two painters — `renderCanvases` (raster A4) and `renderPdfBlob` (pdf-lib vector text w/ embedded Noto subsets via lib/cjkFont; throws offline → caller rasters) |
| `lib/cjkFont.ts` | On-demand Noto Sans TC/JP/KR for selectable-text PDFs: parse Google css2 `unicode-range` blocks, download ONLY the woff2 subsets the document's codepoints touch, wawoff2 (classic-script injected Emscripten) decompresses woff2→TTF for pdf-lib subsetting; `segment()` splits strings into per-subset runs |
| `components/DocEditor.tsx` | Source textarea + live preview (split/source/preview) for doc items: md/html/csv(first sheet)/json/text; DOCX edits as Markdown and is regenerated on save; Ctrl+S saves, Tab inserts |
| `components/SheetEditor.tsx` | Spreadsheet grid editor (csv/tsv/xlsx/xls/ods): tab per sheet, plain-input cells (Enter/Tab/arrow nav), row/col insert/delete/move, header-row toggle, 300-row windows w/ "show more"; save = xlsx (all sheets) or csv/tsv text of active sheet |
| `lib/qr.ts` | QR encode (node-qrcode) / decode (jsQR), both lazy: `qrToCanvas`/`qrToSvg` (QrStyle: colours, size, quiet zone, ECC, centre logo), `decodeQr` downsamples then retries inverted/contrast-boosted, `payloads` builders + `classifyPayload` |
| `components/QrTool.tsx` | QR modal, two tabs — MAKE: template (text/URL/Wi-Fi/vCard/mail) → styled live preview, download PNG/SVG, copy, push PNG into converter; READ: drop/pick/paste or camera scan → decoded payload w/ type-aware actions |
| `lib/qpdf.ts` | qpdf-wasm (lazy, `qpdf.wasm?url`): `decryptPdf(bytes, pw)` / `encryptPdf(bytes, user, owner)` (AES-256) — fresh module per call, `QpdfError` carries the CLI log |
| `components/GifEditor.tsx` | ScreenToGif-style: decodes via `decodeAnim` (GIF **and** APNG), film strip thumbs, per-frame delete/dup/move/delay, dedupe (32px signature merge), draggable caption layers (relative x/y), flatten toggle + matte, output GIF or APNG |
| `components/FormatMatrix.tsx` | Supported-formats section + per-kind editor capability notes |
| `components/DualRange.tsx` | Generic dual-handle slider (time or frame ranges) |
| `components/Overlay.tsx` | Portal-to-body modal backdrop — use for ALL modals (see invariant 17) |
| `components/FramePicker.tsx` | Video → frames: single-frame (image projects) or clip w/ fps (GIF projects). Inlines its own portal — keep in sync with Overlay |
| `components/SettingsPanel.tsx` | Controlled Settings form (5 sections), single `set(key,val)` mutator; only ever mounted inside the drawer |
| `components/ColorPicker.tsx` | Inline HSV picker (SV square + hue strip + hex), used in ImageEditor layer panel |
| `components/InfoTip.tsx` | `(i)` glyph + fixed-position portal tooltip (`.tip-pop`) |
| `components/Studio.tsx` | **Typed projects** (App `mode==='studio'`): launcher (type picker at creation — type is immutable; storage stats; zip import/export w/ id remap), 4-way workspace routing (audio→Mixer, image→inline ImageEditor w/ persisted layers, gif→inline GifEditor, video→VideoWorkspace), primary-asset pickers (◎), blank canvas, new-project-from-asset |
| `components/VideoWorkspace.tsx` | Video project: preview + trim (DualRange) + embedded Mixer; export = renderMixWav → `muxVideo` → MP4 |
| `components/Mixer.tsx` | Multi-track timeline: sticky track heads (name/M/S/gain), draggable+edge-trimmable clips w/ waveform canvas, ruler seek, playhead rAF, split-at-playhead, mic recording (MediaRecorder→asset→new track), WAV export |
| `lib/studioTypes.ts` | `Clip`/`Track`/`MixerDoc`/`ProjectRec`/`AssetRec`, `uid()` |
| `lib/idb.ts` | IndexedDB `morphkit-studio`: `projects` store + `assets` store (index `projectId`) |
| `lib/useSplitter.ts` | Draggable panel-size hook (localStorage-persisted, dblclick reset) behind every `.split-gutter`/`.ie-gutter` |
| `lib/audioEngine.ts` | AudioBuffer decode cache (assetId-keyed), `playMix` live graph (solo/mute logic), `renderMixWav` OfflineAudioContext, `peaks` for waveforms |
| `lib/wav.ts` | AudioBuffer → 16-bit PCM WAV |
| `gif-libs.d.ts` | Hand-written types for gifuct-js / gifenc / upng-js |

## Invariants & gotchas (violating these causes regressions)

1. **i18n**: `t(key)` falls back to en → missing keys render the raw key. Add zh+en+ja together.
2. **Object URLs**: `Item.outUrl` and `Item.meta.preview` must be revoked on remove/clear/replace (`revokePreview` in App).
3. **ffmpeg pool**: one job per instance; app-level semaphore caps pool size. Never call `ff.exec` concurrently on one instance.
4. **GIF transparency**: plain quantize turns alpha into black. Keep alpha ⇒ `rgba4444` format + `transparent: true` + `dispose: 2` (see `writeGifFrame`).
5. **Text tool focus bug**: canvas `pointerdown` must `preventDefault()` or it blurs the floating text input instantly.
6. **`.tool-btn.active:hover`** needs explicit `color: var(--bg)` — the generic hover rule otherwise paints ink-on-ink.
7. **Editor canvases** are full-resolution; zoom is CSS width only. Pointer→canvas mapping divides by `getBoundingClientRect`.
8. **ImageEditor history**: entries share the base `Blob` by reference; geometry ops (crop/rotate/flip/wand) create a new base blob AND transform object coordinates.
9. Build output goes nowhere near the repo: `dist/` is gitignored.
10. Bullet-proof rule: after edits run `npx tsc` — the project is strict-mode clean.
11. **Studio persistence**: mixer doc saves to IndexedDB debounced 500ms via `persist()`; clips reference assets by id — deleting an asset must strip its clips AND `dropAssetBuffer`.
12. **AudioContext** is created lazily (user gesture) — never at module load. Buffers must be decoded (cache warm) before `playMix`/`renderMixWav`; Studio warms the cache on project load.
13. **MediaEdit trim preview**: never seek-back on reaching trim end (causes visible shake); trim handles scrub `currentTime` instead.
14. **Typed projects**: `ProjectRec.type` is set at creation and immutable; legacy records without `type` are 'audio'. `savePatch` updates `curRef` synchronously — required for rapid patch bursts (trim drags, `onObjectsChange`). The async init load MERGES into `projects` and only fills a null `curId` — clobbering either wipes a project created before the IndexedDB read resolves (savePatch then no-ops on a null curRef and the record never persists).
15. **ImageEditor inline mode**: `initialObjects` consumed once at mount (key by base asset id); `objId` must be bumped past loaded ids. Pseudo-Items passed to inline editors MUST be memoized or the init effect loops.
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
19. **Metadata**: tags need `-map_metadata 0`; MP3 additionally needs `-id3v2_version 3` (v2.4 breaks Windows/older players) + `-write_id3v1 1`. Cover art is a single-frame video stream — it requires an explicit `-map 0:a -map 0:v:0? -c:v copy -disposition:v:0 attached_pic` and must NOT be attempted for WAV/OGG (unplayable output) or when trimming (stream desync). `convertMedia` retries once without art if the mapped run fails.
20. **Audio bitrate mode**: `rateOpts` owns the CBR/VBR split. `-q:a` scales are
    encoder-specific and point opposite ways — libmp3lame 0(best)…9, libvorbis
    0…10(best) — so `audioQuality` is mirrored for vorbis. Native AAC VBR is
    experimental, so m4a always uses `-b:a`.
21. **Cross-type imports**: asset-panel ↧ routes by project type (Studio `importAssetToEditor`). Image layers persist as ≤1024px dataURL in `Obj.src`; runtime bitmaps live in module-level `imgBmpCache` keyed by obj id. GIF appends contain-fit imported frames to its own canvas size. GIF→video conversion is capped at 15 MB.
22. **Mobile layer** (end of styles.css; details in `docs/claude/styles.md`): the page must NEVER
    scroll horizontally — html/body carry `overflow-x: clip` + `overscroll-behavior-x: none`
    (a sideways pan on mobile triggers the browser's back-swipe); viewport-wide decorations get
    clipped by their container (`.hero` overflow:hidden). Breakpoints 640 (phone: modal editors become full-width sheets, inputs ≥16px for iOS focus-zoom) / 760 (studio stacks AND switches to auto height so the page scrolls). Hover-only affordances need a `@media (hover:none)` fallback; new drag surfaces need `touch-action:none` + `setPointerCapture`; `.trk-head`/`.lane` CSS must mirror `HEAD_W`/`LANE_H` in Mixer.tsx; `.ed-options` stays a nowrap fixed-height scroller by design; new `100vh` layout values need a dvh override in the `@supports (height:100dvh)` block.
23. **Mobile image editor** (≤720): layers panel becomes a fixed bottom sheet (`.layers-panel.open`, `panelOpen` state + `.lp-fab` toggle + `.lp-scrim` in ImageEditor.tsx). ≤640 the modal editor with `.ie-layout` is a **100dvh paint-app GRID** — canvas owns the screen, `.ed-toolbar` becomes a 50px vertical scrolling left rail, `.ed-options` a thin bottom strip, foot last (`.kbd-hints` hidden). The inline editor gets the same rail grid ≤760, where the rail MUST keep its `max-height` cap (42vh/56vh + strip) or its content sizes the grid row and the page grows huge. The base `.ie-layout` is `align-items:start` — the modal override needs `stretch` or the viewport collapses.
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
    `mammoth/mammoth.browser.js` (the node entry pulls fs/path). PDF/PNG output is RASTERIZED by
    `layoutHtml` (no font files → CJK renders, text unselectable — say so in UI copy). turndown-gfm
    only converts tables with a header row and chokes on `<p>` inside cells → `normalizeTablesForMd`
    runs before every html→md. Documents have no Studio type (`openAsProject` bails, FileCard hides
    the button). All five doc libs are lazy `import()`s (mammoth 500 kB, xlsx 430 kB chunks).
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
30. **PWA**: `public/sw.js` caches by `VERSION` const — bump it whenever caching semantics change or stale shells linger; ffmpeg core (unpkg) + Google Fonts are cached cross-origin by hostname allowlist. SW registers PROD-only (dev HMR fights a cached shell). Theme is 3-state (auto=follow OS, default / light / dark — `useTheme` in App.tsx; auto listens to `prefers-color-scheme` live). `theme-color` meta hexes live in TWO places (index.html inline script for first paint, `THEME_COLORS` in App.tsx) and must match `--bg` light/dark. ≤640 the bottom `.m-tabbar` owns mode switching (topbar `.studio-toggle` hides) and `.app` needs its padding-bottom clearance.

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

## Conventions

- New converter feature → param in `settings.ts` + section in `SettingsPanel` + wire into `buildArgs` (recipe: `/add-setting`).
- New editor capability → keep it object-model (ImageEditor) or frame-model (GifEditor); bake only geometry.
- Structural change to a mapped file → update its `docs/claude/*.md` map in the same commit.
- Commits: conventional-ish (`feat:`, `fix:`, `design:`, `docs:`), one logical change each, always build first.
