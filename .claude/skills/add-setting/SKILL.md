---
name: add-setting
description: Add a new converter setting end-to-end (settings.ts → settingFields registry → buildArgs/convert path → i18n ×3). Use whenever a new user-tunable conversion parameter is requested.
---

# Add a converter setting

Recipe for MorphKit's convention: "New converter feature → param in settings.ts + one entry in
lib/settingFields.ts + wire into buildArgs". Read `docs/claude/libs.md` first if unfamiliar.

## Steps

1. **`src/lib/settings.ts`** — add the field to `interface Settings` AND `DEFAULT_SETTINGS`.
   Use a literal union for enum-like values. NEVER rename existing fields (localStorage
   `morphkit-settings` is unversioned — renames silently drop the user's saved value).
2. **`src/lib/settingFields.ts`** — add ONE entry to `SETTING_FIELDS`, next to its section's
   neighbours: `key`, `section`, `labelKey`, `control` (select with `choices`, range with `show`, or
   check), optional `hintKey`. Do not touch SettingsPanel or FileCard: both draw themselves from
   this list. Set `applies: (kind, target) => …` to exactly the conversions that READ the setting
   (use the shared constants — `AUDIO_OUTPUTS`, `AV_TARGETS`, `RASTER_OUTPUTS`, …); that is what puts
   it on the right file cards as a per-file option. Leave `applies` out only for app-wide settings.
   Conditional fields use `visible` / `disabled` (see `audioQuality`, `videoCrf`).
3. **Wire into conversion**:
   - audio/video → `buildArgs` (or a helper like `rateOpts`/`audioOpts`/`vfChain`) in
     `src/lib/ffmpegClient.ts`. Trim args go BEFORE `-i`; vf order is rotate→setpts→extra→scale.
     Remember encoder quirks: vorbis `-q:a` scale is inverted (10−q); m4a/aac never VBR.
   - static images → `convertImage` params in `src/lib/imageConvert.ts` + call site in App `runConvert`.
   - gif/apng → `convertAnimImage` / `encodeGIFBlob` in `src/lib/animImage.ts`.
   - In App `runConvert`, read the value from `s` (the file's effective settings), never from
     `settingsRef.current` (CLAUDE.md invariant 33).
   - PDF → images → the `pdfToImages` arguments in App `runConvert` (like `pdfImageScale`).
   - documents → the `ConvertDocOpts` object App `runConvert` passes to `convertDoc` (like `docPdfText`).
4. **i18n** — add the label key (+ hint key if any) to ALL THREE dicts in `src/i18n.tsx`
   (find them with `const zh: Dict`, `const en: Dict`, `const ja: Dict`) at the matching position.
   Missing keys render as the raw key string with no warning; `npm run check:context` catches them.
5. **Verify** — `npx tsc` must pass clean (strict mode), and `npm test`: add a case to
   `tests/ffmpegArgs.test.ts` when the setting changes ffmpeg arguments (it asserts on the argv
   `buildArgs` returns) and keep `tests/settings.test.ts` green (old saved settings must still load).
   `tests/fileOptions.test.tsx` fails until the new key has its registry entry; add the key to its
   "gives each conversion only the settings that change it" expectations.
   Then `npm run check:context`.

## Checklist

- [ ] Settings interface + DEFAULT_SETTINGS
- [ ] One `SETTING_FIELDS` entry with the right `applies`
- [ ] Wired into the actual conversion path
- [ ] zh + en + ja keys added
- [ ] Test for the new behaviour; `npx tsc`, `npm test`, `npm run check:context` clean
