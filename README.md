# MorphKit — The Swiss-army file converter

[English](README.md) | [繁體中文](README.zh-TW.md)

A 100% static website. Image, audio and video conversion runs entirely inside the browser — files never leave the user's device.

## Features

Three conversion categories: images (PNG / JPG / WEBP / BMP / GIF / AVIF → WEBP / PNG / JPG, with a quality slider), audio (MP3 / WAV / OGG / FLAC / M4A / AAC / OPUS), and video (MP4 / WEBM / MOV / AVI / MKV → MP4 / WEBM / GIF, or MP3 audio extraction). The UI ships with light / dark themes and three languages (繁體中文 / English / 日本語); preferences persist in localStorage.

Advanced features: per-task progress bars (plus a download progress bar for the engine itself); configurable parallel workers (1–4, each an independent ffmpeg.wasm instance sharing a single downloaded core); a conversion settings panel (audio bitrate, video CRF, GIF frame rate and width); and file metadata extraction — image dimensions, media duration, and photo EXIF (camera, lens, ISO, shutter, aperture, focal length, capture time, and GPS location with a map link, parsed by [exifr](https://github.com/MikeKovarik/exifr)).

## Architecture

- **Vite + React + TypeScript**, with `base: './'` so the build works under any GitHub Pages path
- **Images**: native Canvas API — zero extra download
- **Audio / video**: [ffmpeg.wasm](https://ffmpegwasm.netlify.app/) single-thread core (~31 MB), lazily loaded from CDN on first use. The single-thread build needs no COOP/COEP headers, so it runs on GitHub Pages out of the box
- Conversion jobs are scheduled through a counting semaphore capped at the user's worker setting

## Local development

```bash
npm install
npm run dev      # dev server
npm run build    # outputs dist/
```

## Deploying to GitHub Pages

1. Create a GitHub repo and push this folder:

   ```bash
   git init
   git add -A
   git commit -m "MorphKit initial commit"
   git branch -M main
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   ```

2. In the repo, go to **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.
3. Every push to `main` builds and deploys automatically (workflow in `.github/workflows/deploy.yml`).

## Known limitations

- Browser memory tops out around 1.8–2 GB; larger files will almost certainly fail (the UI warns the user)
- ffmpeg.wasm is 5–20× slower than native ffmpeg — be patient with large videos; WEBM (VP8) encoding is especially slow
- Animated GIFs are currently treated as images (first frame only); to keep the animation, convert the source as video → GIF
- Canvas WEBP export is unsupported in older Safari
- The conversion engine loads from the unpkg CDN, so audio / video conversion is unavailable offline (images are unaffected)
