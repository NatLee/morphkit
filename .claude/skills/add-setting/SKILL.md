---
name: add-setting
description: Add a new converter setting end-to-end (settings.ts → SettingsPanel → buildArgs/convert path → i18n ×3). Use whenever a new user-tunable conversion parameter is requested.
---

# Add a converter setting

Recipe for MorphKit's convention: "New converter feature → param in settings.ts + section in
SettingsPanel + wire into buildArgs". Read `docs/claude/libs.md` first if unfamiliar.

## Steps

1. **`src/lib/settings.ts`** — add the field to `interface Settings` AND `DEFAULT_SETTINGS`.
   Use a literal union for enum-like values. NEVER rename existing fields (localStorage
   `morphkit-settings` is unversioned — renames silently drop the user's saved value).
2. **`src/components/SettingsPanel.tsx`** — add a control in the right `.sp-section`
   (General / Image / Audio / Video / GIF). Follow the existing pattern:
   `label.sp-field > span.sp-label [+ span.sp-val] > select|input [+ span.sp-hint]`;
   checkboxes use `label.sp-field.sp-check`. Mutate ONLY via `set('field', value)`.
   Conditional fields follow the `audioRateMode === 'vbr'` example.
3. **Wire into conversion**:
   - audio/video → `buildArgs` (or a helper like `rateOpts`/`audioOpts`/`vfChain`) in
     `src/lib/ffmpegClient.ts`. Trim args go BEFORE `-i`; vf order is rotate→setpts→extra→scale.
     Remember encoder quirks: vorbis `-q:a` scale is inverted (10−q); m4a/aac never VBR.
   - static images → `convertImage` params in `src/lib/imageConvert.ts` + call site in App `runConvert`.
   - gif/apng → `convertAnimImage` / `encodeGIFBlob` in `src/lib/animImage.ts`.
4. **i18n** — add the label key (+ hint key if any) to ALL THREE dicts in `src/i18n.tsx`
   (zh ≈ lines 13–295, en ≈ 297–579, ja ≈ 581–863) at the matching position. Missing keys
   render as the raw key string with no warning.
5. **Verify** — `npx tsc` must pass clean (strict mode). If the setting affects ffmpeg args,
   sanity-check the generated argv by reading the `buildArgs` branch you touched.

## Checklist

- [ ] Settings interface + DEFAULT_SETTINGS
- [ ] SettingsPanel control (correct section, `set()` only)
- [ ] Wired into the actual conversion path
- [ ] zh + en + ja keys added
- [ ] `npx tsc` clean
