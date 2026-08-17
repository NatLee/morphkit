# MorphKit — Simple file converter

[English](README.md) | [繁體中文](README.zh-TW.md)

A 100% static website. Conversion **and editing** for images, audio, video, GIF and APNG — everything runs inside the browser. No backend, no uploads.

## Converting

Images: PNG / JPG / WEBP / BMP / GIF / APNG / AVIF → WEBP / PNG / JPG / **APNG** / **GIF** (quality slider; GIF ⇄ APNG keeps every frame, APNG preserves full alpha, GIF output can keep 1-bit transparency or be flattened onto a matte). Audio: MP3 / WAV / OGG / FLAC / M4A / AAC / OPUS. Video: MP4 / WEBM / MOV / AVI / MKV → MP4 / WEBM / GIF, or MP3 extraction.

Batch toolbar with overall progress and ZIP download; configurable parallel workers (1–4 ffmpeg.wasm instances sharing one downloaded core); a settings drawer with per-category parameters (image max dimension; audio bitrate / sample rate / channels; video CRF / preset / resolution / fps / mute; GIF fps / width). File info per type: dimensions, duration, estimated bitrate, and photo EXIF (camera, lens, ISO, shutter, aperture, GPS with map link). Paste a file with Ctrl+V to add it; copy image results back to the clipboard with one click.

## Editing

- **Audio / video**: trim (dual-handle timeline + playhead marking), volume, speed, rotation — applied as ffmpeg options at convert time.
- **Images** (Graphite-inspired): non-destructive object model with a layers panel — select/move/reorder/hide every stroke; pen with 3 brushes (pen / marker / highlighter), shapes, arrows, text (font family / bold / auto-contrast outline, CJK via system fonts), crop, rotate/flip, **magic-wand background removal** (flood fill with tolerance), zoom, 40-step undo, Ctrl+C copies the composite, Ctrl+V pastes text.
- **GIF / APNG** (ScreenToGif-inspired): thumbnail film strip, play/step transport, per-frame delete / duplicate / reorder / delay, duplicate-frame merging, frame-range trim, speed, reverse, boomerang, **draggable caption layers** with per-caption frame ranges, transparency flattening with matte colour, output as GIF or APNG.

## Architecture

- **Vite + React 18 + TypeScript**, `base: './'` — works under any GitHub Pages path
- Static images: Canvas API. Animated images: gifuct-js + gifenc + upng-js. Audio/video: [ffmpeg.wasm](https://ffmpegwasm.netlify.app/) single-thread core (~31 MB, lazy-loaded from CDN; no COOP/COEP headers needed, so plain GitHub Pages works)
- See `CLAUDE.md` for the full file map, invariants and design-language notes

## Local development

```bash
npm install
npm run dev      # dev server
npm run build    # outputs dist/
```

## Deploying to GitHub Pages

1. Push this folder to a GitHub repo.
2. **Settings → Pages → Build and deployment → Source** → select **GitHub Actions**.
3. Every push to `main` builds and deploys automatically (`.github/workflows/deploy.yml`).

## Known limitations

- Browser memory tops out around 1.8–2 GB; larger files will fail (the UI warns)
- ffmpeg.wasm is 5–20× slower than native; WEBM (VP8) encoding is especially slow
- Animated decode is capped at 300 frames; very long GIFs are truncated
- Canvas WEBP export is unsupported in older Safari; clipboard copy requires a secure context (HTTPS)
- The conversion engine loads from the unpkg CDN, so audio/video conversion is unavailable offline (images are unaffected)
