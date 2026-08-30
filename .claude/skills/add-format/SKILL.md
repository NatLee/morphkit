---
name: add-format
description: Wire a new input or output format into MorphKit (formats.ts registry → conversion route → FormatMatrix chips). Use when asked to support a new file format.
---

# Add a format

Read `docs/claude/libs.md` (formats.ts + ffmpegClient/animImage/imageConvert sections) first.

## New INPUT format (just accept & detect)

1. `src/lib/formats.ts` — add the extension to `IMAGE_EXT`/`AUDIO_EXT`/`VIDEO_EXT`.
   `detectKind` checks MIME prefix first, then these lists. Decoding is the browser's or
   ffmpeg's job — no other wiring needed unless the browser can't decode it.
2. If DropZone's `accept="image/*,audio/*,video/*"` wouldn't match the MIME, extend it.

## New OUTPUT format

1. `src/lib/formats.ts` — add to the right `*_OUTPUTS` tuple + `mimeFor` map. Check
   `defaultTarget` still picks something sensible; `outputFileName` if the ext differs
   from the format name (like jpeg→.jpg).
2. **Route the conversion** (pick one):
   - ffmpeg-based (audio/video): add a `case` branch in `buildArgs`
     (`src/lib/ffmpegClient.ts`). Decide metadata policy (`metaOpts`), cover-art capability
     (`ART_CAPABLE` — only add if the container truly supports attached_pic; WAV/OGG must NOT),
     and bitrate/quality flags (`rateOpts` — note vorbis inversion, native aac has no usable VBR).
   - Canvas-based (static image): extend `convertImage` target union in `src/lib/imageConvert.ts`
     (browser `toBlob` must support the MIME) + App `runConvert` routing.
   - PDF-based (pdf ⇄ image/text): extend `src/lib/pdf.ts` (`pdfToImages` / `pdfToText` /
     `buildPdf`) + `PDF_OUTPUTS`; pdf.js and pdf-lib stay lazy `import()`s (invariant 25).
   - Document-based (docx/md/html/txt/csv/xlsx/json): extend `convertDoc` in `src/lib/docs.ts`
     (+ `docOutputs`/`docTypeOf` in formats.ts). New targets usually mean one more `htmlTo*` writer.
   - Frame-based (animated): extend `convertAnimImage` in `src/lib/animImage.ts`. Keep-alpha GIF
     output MUST use `rgba4444` + `transparent: true` + `dispose: 2` (invariant 4).
3. `src/App.tsx` `runConvert` — make sure the new target reaches the right converter
   (apng/gif images route to `convertAnimImage`, NOT ffmpeg).
4. `src/components/FormatMatrix.tsx` — the `MATRIX` chips are hardcoded strings, not derived
   from formats.ts. Add the chip so the marketing section stays truthful.
5. i18n — only needed if you add visible labels (all three dicts: zh/en/ja).
6. Verify: `npx tsc` clean, then convert a real file of that kind in `npm run dev` if feasible.

## Checklist

- [ ] formats.ts registry (outputs/mime/default/filename)
- [ ] Conversion branch (ffmpeg buildArgs case | imageConvert | animImage)
- [ ] App runConvert routing correct
- [ ] FormatMatrix chips updated
- [ ] `npx tsc` clean
