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
Local `useTheme()` hook: 3-state `pref` auto|light|dark (cycled by `toggle`; persisted to
`localStorage['morphkit-theme']`, anything else = auto) — auto follows `prefers-color-scheme`
LIVE via a matchMedia listener; `applyTheme` writes `dataset.theme` + the `theme-color` meta.

**Functions** (greppable): `acquireSlot`/`releaseSlot` · `updateSettings` · `patch(id, partial)` ·
`addFiles` (detectKind → defaultTarget → extractMeta per file) · `runConvert(id)` (doc→`convertDoc` (multi → .zip) / pdf→pdfToImages|pdfToText|pdf→docx/md/html via text→convertDoc|
mergeToPdf re-save, multi-page raster swaps `outName` to .zip / image→pdf→imageToPdf / image→convertImage /
apng|gif→convertAnimImage / else convertMedia) · `schedule(id)` (images run immediately EXCEPT image→pdf; a/v + pdf
queue through semaphore) · `addNote(text)` (Ctrl+V plain text or the DropZone `.dz-note` link → note-N.md doc item, editor opens) ·
`qrOpen` state (null closed / '' maker / text reader) renders `<QrTool>`; topbar `.qr-btn` + 4-tab phone bar + FileCard chip open it ·
`mergeAll` + `merging` state (batch bar `mergePdf`: every pdf+image item → one PDF download,
shown when `mergeable` > 1) · `convertAll` · `revokePreview(it)` · `remove`/`clearAll` (must revoke `outUrl` + `meta.preview`) ·
`downloadAll` (fflate zipSync → morphkit.zip) · `isGifItem` (routes gif/apng to GifEditor) ·
`openAsProject(id)` (idb `createProjectWithAsset` → localStorage `'morphkit-project'` →
`<Studio enterProjectId>` jumps into the workspace) ·
`saveMediaEdit`/`saveEditedImage`/`saveEditedGif`/`saveEditedPdf`/`saveEditedDoc` (doc = replace file, status ready) (gif + pdf saves mark the item done immediately —
the edited file IS the deliverable; pdf save also clears `pdfPassword`). `unlockPdf(id, pw)` verifies with
pdf.js then patches `pdfPassword` + re-probes meta; `pwFor` state renders `<PdfPasswordModal>` (opened by
FileCard `onUnlock`, by `schedule` on a locked pdf, by `mergeAll` hitting a locked item, or by `runConvert`
catching `PdfPasswordError`). PDF→PDF falls back to `rasterizePdf` when qpdf can't decrypt.
Effects: window `paste` (skipped while editor/drawer open), `keydown` Escape closes drawer.

**JSX shell**:
```
div.app (+ .studio-mode)
  header.topbar
    div.brand > span.brand-mark + span.brand-name
    div.topbar-actions > button.studio-toggle + div.lang-switch(×3 buttons) + button.theme-toggle(gear=settings) + button.theme-toggle(auto half-circle/sun/moon cycle)
  main → <Studio/>  |  <Hero compact={items.length>0}/> + section.workbench + <FormatMatrix/>
    section.workbench
      <DropZone onFiles=addFiles compact={items.length>0}/>
      div.banner.info.engine-banner (loading: .spinner + .engine-dl > .fc-progress > .fc-bar + .fc-pct)
      div.banner.danger|warn|note (engine error / skipped / hasVideo)
      div.batch-bar > div.bb-info (.bb-count, .bb-progress-wrap > .bb-progress > .bb-bar, .bb-done)
                    + div.bb-actions (convertAll btn-accent · downloadAll · clearAll)
      div.file-list > <FileCard/>×n
  {editingItem && (<GifEditor>|<ImageEditor>|<PdfEditor>|<DocEditor>|<MediaEditor>)}   ← portaled to body
  {pwFor && <PdfPasswordModal/>}
  div.drawer-overlay > aside.drawer > .drawer-head + <SettingsPanel/>   (showSettings)
  <InstallPrompt/>   (PWA add-to-home-screen card, self-hiding)
  nav.m-tabbar > button×3 convert/studio/settings (phone-only bottom tabs, hidden >640 via CSS;
    mirrors studio-toggle + settings drawer — topbar .studio-toggle hides ≤640)
  footer.footer   (hidden in display-mode: standalone)
```

PWA: `applyTheme` (useTheme) syncs the `theme-color` meta; the index.html inline script sets the
first-paint value (stored pref, else OS); `main.tsx` registers `public/sw.js` PROD-only (invariant 24).

**i18n keys**: backLabel settings themeAuto themeLight themeDark engineLoading engineError unsupported{names}
warnVideo filesSummary{n,size} progressSummary{done,total} convertAll downloadAll clearAll close
tabConvert tabSettings (tab bar) · installTitle installBody installBtn installLater installIosHint
(InstallPrompt).

## FileCard.tsx (~290)

`KIND_ICONS` has 5 kinds (doc = page-with-lines) (pdf glyph = `PDF_ICON` exported from FormatMatrix); `EDIT_ICONS.pdf`; `kindKey` picks
kindImage/kindAudio/kindVideo/kindPdf/kindDoc. `.fc-qr` chip (meta.qr) opens the QR tool via `onQr`. Doc rows: words chip (`docWordsN`), details `docWords`/`docChars`/`docLines`/`docSheets`; target lists come from `outputsFor(item.kind, item.file)` (docs vary by sub-type); the open-as-project button is hidden for doc. PDF rows: pages chip (`pdfPagesN`) instead of W×H; details add
`pdfPages`/`pdfPageSize`/`tagTitle`/`pdfAuthor`; quality slider also for pdf→jpeg/webp. `locked` (encrypted &&
no `pdfPassword`) swaps convert for a 🔒 `pdfUnlock` button and routes edit to `onUnlock`; `.fc-lock(.open)` chip.

State: `showDetails`, `copied` (1.5s). `copyResult()` fetches outUrl → canvas → ClipboardItem PNG.
Props: `{item, onTarget, onQuality, onConvert, onRemove, onEdit, onToProject}`.

```
article.file-card.kind-*.status-*
  div.fc-main (flex, wraps)
    div.fc-thumb>img | div.fc-icon>svg
    div.fc-meta (min-width:180px) > p.fc-name + p.fc-info (.fc-kind .fc-size×n .fc-edited)
    div.fc-controls > btn fc-edit · btn.fc-to-studio (openAsProject) · btn fc-detail-btn · label.fc-target>select
      · div.fc-chips (.fc-chips-label + button.fc-chip×n — phone-only target picker; ≤640 CSS hides
        .fc-target and shows the chips: the native select's popup covered the card's controls)
      · a|button.btn-accent (download/convert) · btn copy · btn.fc-remove
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

- **Hero.tsx (~50)**: prop `compact` (App passes `items.length > 0`) — `.hero(+.hero-compact) >
  div.hero-fold > div.hero-fold-inner (p.hero-tagline + h1.hero-title>span.hero-accent) + div.feat-row>span.feat×6`.
  Compact folds tagline+title away (grid-template-rows 1fr→0fr transition on `.hero-fold`) and shrinks
  hero padding; feat chips stay. Chips: featTrim/featPaint/featGif/featPdf/featDoc/featQr, coloured
  by `.feat:nth-child(n)` — new chips must extend both the i18n keys (×3) and the nth-child CSS.
  NOTE: `.hero-stage`/`.format-card`/`.fsel`/`.stage-*` CSS still exists but is DEAD — Hero no longer
  renders the conversion stage (format pickers removed on purpose). Don't style them.
- **DropZone.tsx (80)**: `div.dropzone(+.over)(+.dz-compact)[role=button]` wrapping hidden
  `input[type=file multiple accept=image/*,audio/*,video/*,application/pdf,.pdf,.docx,.pptx,.md,…,.xlsx,.json]`;
  optional `onNewNote` renders the `.dz-note` blank-Markdown link (stopPropagation).; drag handlers + click + Enter/Space;
  input value reset after pick so same file re-picks. Prop `compact` (App: items exist) swaps the
  hero layout for a slim row (plus glyph + `dropMore` + kbd hint, `.dz-compact` CSS).
  `.dz-kbd` (Ctrl+V hint) is hidden on touch via `@media (hover:none)`.
- **Overlay.tsx (14)**: `createPortal(div.editor-overlay, document.body)` — invariant 17 lives here.
  Children must stopPropagation. Page scroll behind overlays is locked via `body:has(.editor-overlay)` CSS.
- **FormatMatrix.tsx (~85)**: static 5 cards (image/audio/video/pdf/doc — `.mx-pdf` violet, `.mx-doc` accent) from module const `MATRIX` (chips are hardcoded uppercase
  strings, NOT derived from lib/formats — update both when adding formats).
- **InfoTip.tsx (47)**: `span.info-i` + portal `.tip-pop` (fixed-position tooltip, never clipped).
- **InstallPrompt.tsx (~110)**: `.install-card > .install-icon + .install-text + .install-btns`.
  Captures `beforeinstallprompt` (Android/desktop → real install button) or shows the iOS
  Share → Add-to-Home-Screen hint; returns null when standalone or dismissed <14 days
  (localStorage `morphkit-install-dismissed`). Desktop corner card, phone full-width above tab bar.

## Cross-cutting

- localStorage: `morphkit-theme`, `morphkit-settings`, `morphkit-lang`, `morphkit-project`, `mk-layout`, `mk-sort`,
  `morphkit-install-dismissed`.
- Fixed/sticky inventory: `.m-tabbar`/`.install-card` (z95), `.drawer-overlay`/`.drawer` (z100/101),
  `.editor-overlay` (z110, Overlay + FramePicker), `.st-note` (z150), `.tip-pop` (z300),
  `.trk-head` (sticky left), grain `body::after` (z999).
- Responsive architecture: see `docs/claude/styles.md`.
