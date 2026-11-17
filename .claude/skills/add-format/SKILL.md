---
name: add-format
description: Wire a new input or output format into MorphKit (formats.ts registry → conversion route → FormatMatrix chips). Use when asked to support a new file format.
---

# Add a format

Read `docs/claude/libs.md` (formats.ts + ffmpegClient/animImage/imageConvert sections) first.

## New INPUT format (just accept & detect)

1. `src/lib/formats.ts` — add the extension to `IMAGE_EXT`/`AUDIO_EXT`/`VIDEO_EXT` (documents:
   `DOC_TEXT_EXT`/`DOC_SHEET_EXT` and `DOC_MIME`; PDF: `PDF_EXT`).
   `detectKind` checks MIME prefix first, then these lists. Decoding is the browser's or
   ffmpeg's job — no other wiring needed unless the browser can't decode it.
2. Nothing else to touch for the file pickers: DropZone and Studio use `ACCEPT` from
   formats.ts, which is built from these lists.

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
   - Document-based (docx/pptx/md/html/txt/csv/xlsx/json): extend `convertDoc` in `src/lib/docs.ts`
     (+ `docOutputs`/`docTypeOf` in formats.ts). New targets usually mean one more `htmlTo*` writer.
   - Frame-based (animated): extend `convertAnimImage` in `src/lib/animImage.ts`. Keep-alpha GIF
     output MUST use `rgba4444` + `transparent: true` + `dispose: 2` (invariant 4).
3. `src/App.tsx` `runConvert` — make sure the new target reaches the right converter
   (apng/gif images route to `convertAnimImage`, NOT ffmpeg).
4. Overview: the in-app FormatMatrix derives its OUT chips from formats.ts (nothing to do there; IN
   chips are a hand-picked short list). The README picture is drawn from `docs/images/formats.html`:
   add the output to its ROWS (tests/formatsPicture.test.ts fails until you do) and re-render
   `formats-en.webp` / `formats-zh.webp` with the command in its header.
5. i18n — only needed if you add visible labels (all three dicts: zh/en/ja).
6. Verify: `npx tsc` clean and `npm test` (extend `tests/formats.test.ts` for detection, outputs and
   default targets), then convert a real file of that kind in `npm run dev` if feasible.

## Checklist

- [ ] formats.ts registry (outputs/mime/default/filename)
- [ ] Conversion branch (ffmpeg buildArgs case | imageConvert | animImage | pdf.ts | docs.ts)
- [ ] App runConvert routing correct
- [ ] formats.html ROWS + both formats-*.webp re-rendered
- [ ] README format lists and `docs/images/formats-*.webp` still true
- [ ] Tests; `npx tsc` and `npm test` clean
