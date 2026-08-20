# Map: App shell & converter flow

> On-demand map for AI sessions. Read this INSTEAD of re-reading the source files for
> orientation; grep the names below to jump precisely. If structure changed since this
> was written, trust the code and update this file. Covers: `App.tsx`, `Hero`, `DropZone`,
> `FileCard`, `SettingsPanel`, `FormatMatrix`, `DualRange`, `Overlay`, `FramePicker`, `InfoTip`.

## App.tsx (~500 lines) — owns ALL convert-mode state

**State**: `items: Item[]` · `engine: 'idle'|'loading'|'ready'|'error'` · `engineDl {received,total}` ·
`skipped` (rejected names, 6s auto-clear) · `settings` (persisted via saveSettings) · `showSettings` ·
`editingId` · `mode: 'convert'|'studio'` · `studioEnterId` (Studio skips launcher; cleared on manual
toggle). Refs: `itemsRef`, `settingsRef` (stale-closure mirrors),
`runningRef` + `waitersRef` (counting semaphore, cap = `settings.concurrency`). Module `let uid = 0`.
Local `useTheme()` hook flips `document.documentElement.dataset.theme` + `localStorage['morphkit-theme']`.

**Functions** (greppable): `acquireSlot`/`releaseSlot` · `updateSettings` · `patch(id, partial)` ·
`addFiles` (detectKind → defaultTarget → extractMeta per file) · `runConvert(id)` (image→convertImage /
apng|gif→convertAnimImage / else convertMedia) · `schedule(id)` (images run immediately; a/v queue through
semaphore) · `convertAll` · `revokePreview(it)` · `remove`/`clearAll` (must revoke `outUrl` + `meta.preview`) ·
`downloadAll` (fflate zipSync → morphkit.zip) · `isGifItem` (routes gif/apng to GifEditor) ·
`openAsProject(id)` (idb `createProjectWithAsset` → localStorage `'morphkit-project'` →
`<Studio enterProjectId>` jumps into the workspace) ·
`saveMediaEdit`/`saveEditedImage`/`saveEditedGif` (gif save marks item done immediately).
Effects: window `paste` (skipped while editor/drawer open), `keydown` Escape closes drawer.

**JSX shell**:
```
div.app (+ .studio-mode)
  header.topbar
    div.brand > span.brand-mark + span.brand-name
    div.topbar-actions > button.studio-toggle + div.lang-switch(×3 buttons) + button.theme-toggle(gear=settings) + button.theme-toggle(sun/moon)
  main → <Studio/>  |  <Hero/> + section.workbench + <FormatMatrix/>
    section.workbench
      <DropZone onFiles=addFiles compact={items.length>0}/>
      div.banner.info.engine-banner (loading: .spinner + .engine-dl > .fc-progress > .fc-bar + .fc-pct)
      div.banner.danger|warn|note (engine error / skipped / hasVideo)
      div.batch-bar > div.bb-info (.bb-count, .bb-progress-wrap > .bb-progress > .bb-bar, .bb-done)
                    + div.bb-actions (convertAll btn-accent · downloadAll · clearAll)
      div.file-list > <FileCard/>×n
  {editingItem && (<GifEditor>|<ImageEditor>|<MediaEditor>)}   ← portaled to body
  div.drawer-overlay > aside.drawer > .drawer-head + <SettingsPanel/>   (showSettings)
  footer.footer
```

**i18n keys**: backLabel settings themeToggle engineLoading engineError unsupported{names}
warnVideo filesSummary{n,size} progressSummary{done,total} convertAll downloadAll clearAll close.

## FileCard.tsx (268)

State: `showDetails`, `copied` (1.5s). `copyResult()` fetches outUrl → canvas → ClipboardItem PNG.
Props: `{item, onTarget, onQuality, onConvert, onRemove, onEdit, onToProject}`.

```
article.file-card.kind-*.status-*
  div.fc-main (flex, wraps)
    div.fc-thumb>img | div.fc-icon>svg
    div.fc-meta (min-width:180px) > p.fc-name + p.fc-info (.fc-kind .fc-size×n .fc-edited)
    div.fc-controls > btn fc-edit · btn.fc-to-studio (openAsProject) · btn fc-detail-btn · label.fc-target>select · a|button.btn-accent (download/convert) · btn copy · btn.fc-remove
  dl.fc-details (grid; 1 col ≤640) > div.fc-detail-row > dt/dd  (+GPS → Google Maps link)
  div.fc-quality (image jpeg|webp) > input[range .4–1]
  div.fc-progress-row (converting media) > .fc-progress>.fc-bar + .fc-pct
  p.fc-error | p.fc-warn(.danger)
```

## SettingsPanel.tsx (256)

Stateless controlled form; single mutator `set(key, value)` → `onChange({...settings, [key]: value})`.
Module const `VBR_LEVELS: [q,kbps][]` (LAME 0→245 … 9→65). Five `.sp-section` groups: General
(workers select 1–4, keepMetadata, keepCoverArt disabled unless keepMetadata) · Image (imageMaxDim) ·
Audio (audioBitrate, audioRateMode cbr|vbr, audioQuality V0–V9 vbr-only, audioSampleRate, audioChannels) ·
Video (videoCrf range 18–32, videoPreset, videoMaxH, videoFps, videoMute) · GIF (gifFps range 5–24, gifWidth).
Pattern: `label.sp-field > span.sp-label [+span.sp-val] > select|input [+ span.sp-hint]`; checkboxes
`label.sp-field.sp-check`. Mounted ONLY inside `.drawer` (which forces `.sp-grid` to 1 column).

## DualRange.tsx (73) — two-handle slider, no useState

Props `{min, max, start, end, gap=0, onChange, format?}`. `valAt(clientX)` maps px→value via track
getBoundingClientRect. `down(which)` sets pointer capture **on the handle (e.target)** but move/up are
bound on the **track** — capture redirects events, moves arrive via bubbling. Do NOT change nesting or
add stopPropagation, it breaks dragging. `trackDown` grabs the nearest handle (mitigates small handles).
`.dual-track` has `touch-action:none` (required). DOM: `.dual > .dual-track (.dual-fill, .dual-handle×2) + .dual-labels`.

## FramePicker.tsx (178) — video → frames modal

Props `{blob, mode:'single'|'range', onDone(frames:{img:ImageData;delay:number}[]), onClose}`.
Caps: `MAX_FRAMES=120`, `MAX_W=960`. State: duration, pos, range, fps(4–12, default 8), busy, prog.
`seekTo(t)` promise + 1500ms fallback; `grab()` draws to offscreen canvas (willReadFrequently).
**Inlines its own createPortal + `.editor-overlay`** (does NOT use Overlay component — keep in sync).
DOM: `.editor.mini-modal.frame-modal > .ed-preview.mp-video.fp-preview>video[playsInline controls]` +
range input (single) | DualRange (range) + fps select + `.fc-progress` + `.ed-foot-main`.
`.fp-preview` is fixed 240px height (180px ≤640).

## Small components

- **Hero.tsx (30)**: static — `.hero > p.hero-tagline + h1.hero-title(>span.hero-accent) + div.feat-row>span.feat×3`.
  NOTE: `.hero-stage`/`.format-card`/`.fsel`/`.stage-*` CSS still exists but is DEAD — Hero no longer
  renders the conversion stage (format pickers removed on purpose). Don't style them.
- **DropZone.tsx (80)**: `div.dropzone(+.over)(+.dz-compact)[role=button]` wrapping hidden
  `input[type=file multiple accept=image/*,audio/*,video/*]`; drag handlers + click + Enter/Space;
  input value reset after pick so same file re-picks. Prop `compact` (App: items exist) swaps the
  hero layout for a slim row (plus glyph + `dropMore` + kbd hint, `.dz-compact` CSS).
  `.dz-kbd` (Ctrl+V hint) is hidden on touch via `@media (hover:none)`.
- **Overlay.tsx (14)**: `createPortal(div.editor-overlay, document.body)` — invariant 17 lives here.
  Children must stopPropagation. Page scroll behind overlays is locked via `body:has(.editor-overlay)` CSS.
- **FormatMatrix.tsx (56)**: static 3 cards from module const `MATRIX` (chips are hardcoded uppercase
  strings, NOT derived from lib/formats — update both when adding formats).
- **InfoTip.tsx (47)**: `span.info-i` + portal `.tip-pop` (fixed-position tooltip, never clipped).

## Cross-cutting

- localStorage: `morphkit-theme`, `morphkit-settings`, `morphkit-lang`, `morphkit-project`, `mk-layout`, `mk-sort`.
- Fixed/sticky inventory: `.drawer-overlay`/`.drawer` (z100/101), `.editor-overlay` (z110, Overlay + FramePicker),
  `.st-note` (z150), `.tip-pop` (z300), `.trk-head` (sticky left), grain `body::after` (z999).
- Responsive architecture: see `docs/claude/styles.md`.
