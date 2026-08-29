# MorphKit — Context for AI assistants

Read this file first. It replaces the need to re-read the whole codebase.

## What this is

100% static in-browser file converter + editors (image/audio/video/GIF/APNG).
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
| `docs/claude/editors.md` | ImageEditor.tsx (1.7k lines), GifEditor.tsx |
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
| `lib/formats.ts` | Kind detection, output lists, default targets (gif→apng, apng→gif), size thresholds, mime map |
| `lib/imageConvert.ts` | Static images via Canvas (`quality`, `maxDim` downscale-only) |
| `lib/ffmpegClient.ts` | ffmpeg.wasm **single-thread** core (no COOP/COEP → works on Pages), instance **pool** (shared core blob, one download), `buildArgs()` merges Settings + MediaEdit (trim `-ss/-t` before `-i`; vf/af chains) + metadata (`-map_metadata`, `-id3v2_version 3`, cover-art stream map) + bitrate mode (`rateOpts`: CBR `-b:a` vs VBR `-q:a`) |
| `lib/animImage.ts` | GIF/APNG/static → RGBA frames (`decodeAnim`), `encodeAPNG` (upng-js, lossless alpha), `encodeGIFBlob(anim, matte\|null)` — `null` keeps binary alpha via gifenc `rgba4444` + `transparent+dispose:2`; `writeGifFrame` shared with GifEditor |
| `lib/metadata.ts` | Per-kind file info: dims/duration/EXIF-GPS (exifr)/bitrate estimate + `preview` (object URL for images — revoke on remove!, dataURL frame-grab for video) |
| `lib/settings.ts` | Persisted Settings (localStorage `morphkit-settings`) |
| `components/Hero.tsx` | Tagline + title + feature chips only (format pickers were removed on purpose — they misled users) |
| `components/DropZone.tsx` | Accepts image/audio/video, multi-file |
| `components/InstallPrompt.tsx` | PWA install card: `beforeinstallprompt` capture (Android/desktop) or iOS share-hint; 14-day dismiss (localStorage `morphkit-install-dismissed`); hidden when standalone |
| `vite-env.d.ts` | `vite/client` types (`import.meta.env`) |
| `components/FileCard.tsx` | Thumbnail, chips, edit/convert/download/copy-to-clipboard buttons, details panel, warnings |
| `components/MediaEditor.tsx` | A/V trim (DualRange + playhead buttons), volume/speed/rotate → saved as `Item.edit`, applied at ffmpeg time |
| `components/ImageEditor.tsx` | **Raster layer editor**: layer = canvas surface. Tools: pan/move/pen(3 brushes)/eraser/line/rect/ellipse/arrow/text/crop/wand/rectsel/lasso/fill — all paint into the active layer. Layer panel (add/dup/merge-down/delete/reorder/opacity/blend/lock/mask), pixel history, wheel zoom, marching-ants selections, bg layer |
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
14. **Typed projects**: `ProjectRec.type` is set at creation and immutable; legacy records without `type` are 'audio'. `savePatch` updates `curRef` synchronously — required for rapid patch bursts (trim drags, `onObjectsChange`).
15. **ImageEditor inline mode**: `initialObjects` consumed once at mount (key by base asset id); `objId` must be bumped past loaded ids. Pseudo-Items passed to inline editors MUST be memoized or the init effect loops.
16. **muxVideo**: audio timeline aligns to the TRIMMED video start; wav is rendered by OfflineAudioContext first, then mapped `-map 0:v -map 1:a -shortest`.
17. **Modals MUST portal to `<body>`** (`components/Overlay.tsx`, or `createPortal` directly). Any ancestor transform/filter makes itself the containing block for `position:fixed`, which clips the backdrop. Keyframe endings should also be `transform: none` for the same reason.
18. **Layer model is RASTER**: a `Layer` IS a canvas (`pixRef: Map<id, HTMLCanvasElement>`, persisted as `src` dataURL). Every tool paints into the active layer; there are no sub-objects. Rendering composites each layer through a scratch canvas (mask via `destination-in`, then alpha+blend). Geometry ops (crop/rotate/resize) must run `transformLayers` so every layer canvas follows the base. History snapshots ALL layer pixels (cap 14) — keep it that way or undo desyncs.
    **Eraser** = `destination-out` stroke into the active layer. Because the base is composited
    UNDER every layer, erasing a blank active layer first *promotes* the base into a bottom layer
    (`promoteBase`) and swaps in a pre-built transparent base — this MUST stay synchronous
    (an async base swap can land after an undo) and only fires when the active layer is empty
    (a layer with pixels erases its own pixels, like any raster editor). The selection
    「clear」 path (`applyToSelection`) MUST do the same promotion — the wand usually selects
    base pixels, and destination-out into a blank layer silently deletes nothing.
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
23. **Mobile image editor** (≤720): layers panel becomes a fixed bottom sheet (`.layers-panel.open`, `panelOpen` state + `.lp-fab` toggle + `.lp-scrim` in ImageEditor.tsx); ≤640 the modal editor with `.ie-layout` becomes a fixed 100dvh flex column with children REORDERED via `order` (head → canvas fills → options → toolbar → foot) — the base `.ie-layout` is `align-items:start`, the mobile override needs `stretch` or the viewport collapses.
24. **PWA**: `public/sw.js` caches by `VERSION` const — bump it whenever caching semantics change or stale shells linger; ffmpeg core (unpkg) + Google Fonts are cached cross-origin by hostname allowlist. SW registers PROD-only (dev HMR fights a cached shell). Theme is 3-state (auto=follow OS, default / light / dark — `useTheme` in App.tsx; auto listens to `prefers-color-scheme` live). `theme-color` meta hexes live in TWO places (index.html inline script for first paint, `THEME_COLORS` in App.tsx) and must match `--bg` light/dark. ≤640 the bottom `.m-tabbar` owns mode switching (topbar `.studio-toggle` hides) and `.app` needs its padding-bottom clearance.

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
