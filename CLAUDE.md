# MorphKit — Context for AI assistants

Read this file first. It replaces the need to re-read the whole codebase.

## What this is

100% static in-browser file converter + editors (image/audio/video/GIF/APNG).
No backend, no uploads. Deployed to GitHub Pages via `.github/workflows/deploy.yml`
(repo Settings → Pages → Source: GitHub Actions). Vite `base: './'` so any repo name works.

Stack: Vite + React 18 + TypeScript (strict). No CSS framework — single `src/styles.css`
with CSS variables. No state library — App.tsx owns all state.

## Commands

```bash
npm run dev      # dev server
npm run build    # tsc && vite build  (MUST pass before committing)
```

Sandbox note: the mounted FS may refuse to delete `dist/`; build with
`npx vite build --outDir /tmp/morphkit-dist --emptyOutDir` to verify instead.

## File map (src/)

| File | Role |
|---|---|
| `App.tsx` | All app state: items list, settings, scheduler (counting semaphore capped at `settings.concurrency`), engine banners, editors routing, batch bar, ZIP download (fflate), global Ctrl+V paste-file |
| `types.ts` | `Item` (per-file state incl. `edit`, `edited`, `meta`, `outUrl`), `MediaEdit` (trim/volume/speed/rotate), `Status` |
| `i18n.tsx` | Custom context. THREE dicts: zh / en / ja — **every new UI string needs all 3 keys** |
| `styles.css` | Design system "Drafting Table": hairline borders, Instrument Serif display, IBM Plex Sans/Mono, one accent (`--accent`), light default theme. All editors' CSS lives here too |
| `lib/formats.ts` | Kind detection, output lists, default targets (gif→apng, apng→gif), size thresholds, mime map |
| `lib/imageConvert.ts` | Static images via Canvas (`quality`, `maxDim` downscale-only) |
| `lib/ffmpegClient.ts` | ffmpeg.wasm **single-thread** core (no COOP/COEP → works on Pages), instance **pool** (shared core blob, one download), `buildArgs()` merges Settings + MediaEdit (trim `-ss/-t` before `-i`; vf/af chains) |
| `lib/animImage.ts` | GIF/APNG/static → RGBA frames (`decodeAnim`), `encodeAPNG` (upng-js, lossless alpha), `encodeGIFBlob(anim, matte\|null)` — `null` keeps binary alpha via gifenc `rgba4444` + `transparent+dispose:2`; `writeGifFrame` shared with GifEditor |
| `lib/metadata.ts` | Per-kind file info: dims/duration/EXIF-GPS (exifr)/bitrate estimate + `preview` (object URL for images — revoke on remove!, dataURL frame-grab for video) |
| `lib/settings.ts` | Persisted Settings (localStorage `morphkit-settings`) |
| `components/Hero.tsx` | Tagline + title + feature chips only (format pickers were removed on purpose — they misled users) |
| `components/DropZone.tsx` | Accepts image/audio/video, multi-file |
| `components/FileCard.tsx` | Thumbnail, chips, edit/convert/download/copy-to-clipboard buttons, details panel, warnings |
| `components/MediaEditor.tsx` | A/V trim (DualRange + playhead buttons), volume/speed/rotate → saved as `Item.edit`, applied at ffmpeg time |
| `components/ImageEditor.tsx` | Graphite-style **non-destructive object model**: objects[] replayed over base bitmap. Tools: select/pen(3 brushes)/line/rect/ellipse/arrow/text(font/bold/outline)/crop/wand(flood-fill BG removal). Layers panel, zoom, blob-ref history (base blob shared by reference), Ctrl+C copy, Ctrl+V text |
| `components/GifEditor.tsx` | ScreenToGif-style: decodes via `decodeAnim` (GIF **and** APNG), film strip thumbs, per-frame delete/dup/move/delay, dedupe (32px signature merge), draggable caption layers (relative x/y), flatten toggle + matte, output GIF or APNG |
| `components/FormatMatrix.tsx` | Supported-formats section + per-kind editor capability notes |
| `components/DualRange.tsx` | Generic dual-handle slider (time or frame ranges) |
| `components/Studio.tsx` | Project workspace (App `mode==='studio'`): project CRUD (IndexedDB), asset panel (import/drop, per-kind actions), hosts Mixer + reuses Image/Gif editors on assets via pseudo-Item |
| `components/Mixer.tsx` | Multi-track timeline: sticky track heads (name/M/S/gain), draggable+edge-trimmable clips w/ waveform canvas, ruler seek, playhead rAF, split-at-playhead, mic recording (MediaRecorder→asset→new track), WAV export |
| `lib/studioTypes.ts` | `Clip`/`Track`/`MixerDoc`/`ProjectRec`/`AssetRec`, `uid()` |
| `lib/idb.ts` | IndexedDB `morphkit-studio`: `projects` store + `assets` store (index `projectId`) |
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

## Design language ("Drafting Table")

Light default. Hairline `--line` borders, small radii (8/12px), ink-solid primary buttons
(hover → accent), mono labels uppercase 10–12px, serif display headings, blueprint grid hero
backdrop, film-grain overlay. Accent used sparingly: progress, TO-format, chips.out, selection.
No glows, no gradients on white, no purple. Dark theme via `:root[data-theme]` variables only.

## Conventions

- New converter feature → param in `settings.ts` + section in `SettingsPanel` + wire into `buildArgs`.
- New editor capability → keep it object-model (ImageEditor) or frame-model (GifEditor); bake only geometry.
- Commits: conventional-ish (`feat:`, `fix:`, `design:`, `docs:`), one logical change each, always build first.
