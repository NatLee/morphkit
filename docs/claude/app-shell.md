# Map: App shell & converter flow

> On-demand map for AI sessions. Read this INSTEAD of re-reading the source files for
> orientation; grep the names below to jump precisely. If structure changed since this
> was written, trust the code and update this file. Covers: `App.tsx`, `Hero`, `DropZone`,
> `FileCard`, `SettingsPanel`, `SettingControl`, `FormatMatrix`, `DualRange`, `Overlay`, `ConfirmDialog`, `FramePicker`, `InfoTip`,
> `InstallPrompt`.

## App.tsx (781 lines) — owns ALL convert-mode state

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
apng|gif→convertAnimImage / else convertMedia) · `changeTarget` (no-op when unchanged — re-tapping the active phone chip keeps the result; else drops `outUrl`) · `schedule(id)` (images run immediately EXCEPT image→pdf; a/v + pdf
queue through semaphore) · `addNote(text)` (Ctrl+V plain text or the DropZone `.dz-note` link → note-N.md doc item, editor opens) ·
`qrOpen` state (null closed / '' maker / text reader) renders `<QrTool>` (its .qr-overlay sits at z90 ≤640 so the z95 tab bar stays usable and the QR tab
toggles it closed; sticky head + .qr-foot close as fallbacks) · topbar `.qr-btn` + 4-tab phone bar + FileCard chip open it ·
`mergeAll` + `merging` state (batch bar `mergePdf`: every pdf+image item → one PDF download,
shown when `mergeable` > 1) · `convertAll` · `remove`/`clearAll` (only drop items — `useBlobUrlOwner` revokes `outUrl` + `meta.preview` after commit) ·
`downloadAll` (fflate zipSync → morphkit.zip) · `isGifItem` (routes gif/apng to GifEditor) ·
`openAsProject(id)` (idb `createProjectWithAsset` → localStorage `'morphkit-project'` →
`<Studio enterProjectId>` jumps into the workspace) ·
`saveMediaEdit`/`saveEditedImage`/`saveEditedGif`/`saveEditedPdf`/`saveEditedDoc` (doc = replace file, status ready) (gif + pdf saves mark the item done immediately —
the edited file IS the deliverable; pdf save also clears `pdfPassword`). `unlockPdf(id, pw)` verifies with
pdf.js then patches `pdfPassword` + re-probes meta; `pwFor` state renders `<PdfPasswordModal>` (opened by
FileCard `onUnlock`, by `schedule` on a locked pdf, by `mergeAll` hitting a locked item, or by `runConvert`
catching `PdfPasswordError`). PDF→PDF falls back to `rasterizePdf` when qpdf can't decrypt.
OCR (invariant 32): `askOcr` is the `OcrConsent` every OCR job gets — the first caller sets `ocrAsk` (renders a
`<ConfirmDialog tone=accent>` with size + host), later callers await the same `ocrGate` promise. Image `txt` → `imageToText`;
PDF txt/md/html/docx go through `readText` = `withOcr(..., pdfToText(..., read))`.
Effects: window `paste` (skipped while editor/drawer open), `keydown` Escape closes drawer.

**JSX shell**:
```
div.app (+ .studio-mode)
  header.topbar
    div.brand > span.brand-mark + span.brand-name
    nav.mode-nav > button×2 (navHome | navProjects + span.mode-nav-n = `projectCount`, read from idb at mount and reported by <Studio onProjectCount>)
    div.topbar-actions > button.theme-toggle.qr-btn (QR tool) + div.lang-switch(×3 buttons) + button.theme-toggle(gear=settings) + button.theme-toggle(auto half-circle/sun/moon cycle)
  main → <Studio/>  |  <Hero compact={items.length>0}/> + section.workbench + <FormatMatrix/>
    section.workbench
      <DropZone onFiles=addFiles compact={items.length>0}/>
      div.banner.info.engine-banner (loading: .spinner + .engine-dl > .fc-progress > .fc-bar + .fc-pct)
      div.banner.danger|warn|note (engine error / skipped / hasVideo)
      div.batch-bar > div.bb-info (.bb-count, .bb-progress-wrap > .bb-progress > .bb-bar, .bb-done)
                    + div.bb-actions (convertAll btn-accent · mergePdf (when mergeable > 1) · downloadAll (when more than one is done) · clearAll)
      div.file-list > <FileCard/>×n
  {editingItem && (<GifEditor>|<ImageEditor>|<PdfEditor>|<SheetEditor>|<DocEditor>|<MediaEditor>)}   ← portaled to body
  {ocrAsk && <ConfirmDialog tone=accent/>}   (OCR download question)
  {pwFor && <PdfPasswordModal/>}
  {qrOpen !== null && <QrTool/>}
  div.drawer-overlay > aside.drawer > .drawer-head + <SettingsPanel/>   (showSettings)
  <InstallPrompt/>   (PWA add-to-home-screen card, self-hiding)
  nav.m-tabbar > button×4 home/projects/QR/settings (phone-only bottom tabs, hidden >640 via CSS;
    mirrors the topbar nav + settings drawer — topbar .mode-nav hides ≤640;
    PORTALED to <body>: .app is a stacking context (z-index:1), so the bar's z95 was trapped
    under body-portaled overlays like the QR sheet — z comparisons must happen at body level.
    TABS ARE MUTUALLY EXCLUSIVE: every tab closes the other surfaces (setQrOpen(null) +
    setShowSettings(false)) — the QR sheet is an overlay, not a route, and body-portaled QR
    would cover the .app-trapped settings drawer if left open)
  footer.footer   (hidden in display-mode: standalone)
```

PWA: `applyTheme` (useTheme) syncs the `theme-color` meta; the index.html inline script sets the
first-paint value (stored pref, else OS); `main.tsx` registers `public/sw.js` PROD-only (invariant 30).

**i18n keys**: backLabel settings themeAuto themeLight themeDark engineLoading engineError unsupported{names}
warnVideo filesSummary{n,size} progressSummary{done,total} convertAll downloadAll clearAll close
tabConvert tabSettings (tab bar) · installTitle installBody installBtn installLater installIosHint
(InstallPrompt).

## FileCard.tsx (412)

`KIND_ICONS` has 5 kinds (doc = page-with-lines) (pdf glyph = `PDF_ICON` exported from FormatMatrix); `EDIT_ICONS.pdf`; `kindKey` picks
kindImage/kindAudio/kindVideo/kindPdf/kindDoc. `.fc-qr` chip (meta.qr) opens the QR tool via `onQr`. Doc rows: words chip (`docWordsN`), details `docWords`/`docChars`/`docLines`/`docSheets`; target lists come from `outputsFor(item.kind, item.file)` (docs vary by sub-type); "save as project" is offered only for docs that are text-ish (`canProject` = `isTextDoc`). PDF rows: pages chip (`pdfPagesN`) instead of W×H; details add
`pdfPages`/`pdfPageSize`/`tagTitle`/`pdfAuthor`; quality slider also for pdf→jpeg/webp. PPTX rows: slides chip (`docSlidesN`) + `docSlides` detail. `locked` (encrypted &&
no `pdfPassword`) swaps convert for a 🔒 `pdfUnlock` button and routes edit to `onUnlock`; `.fc-lock(.open)` chip.

**Own options** (invariant 33): `fields = fieldsFor(kind, target)`, `eff = effectiveSettings(settings, item.opts)`,
`overrides = activeOverrides(...)`. The row shows "using the defaults" or one chip per override (× sets the default back
through `onOption(id, key, settings[key])`), an Adjust/Done toggle (`optsOpen`) and "Reset all" from two overrides up;
the panel renders `<SettingControl>` for each field with `eff`, so `visible`/`disabled` rules follow the FILE's values.
No row at all when nothing applies (image → ICO).

State: `showDetails`, `copied` (1.5s), `optsOpen`, `menuOpen` (+ `menuRef`; closes on pointerdown elsewhere and Escape).
`copyResult()` fetches outUrl → canvas → ClipboardItem PNG.
Props: `{item, settings, onOption, onResetOptions, onTarget, onQuality, onConvert, onRemove, onEdit, onToProject, onUnlock, onQr}`.

```
article.file-card.kind-*.status-*
  div.fc-main (flex, wraps)
    div.fc-thumb>img | div.fc-icon>svg
    div.fc-meta (min-width:180px) > p.fc-name + p.fc-info (.fc-kind .fc-size×n .fc-edited)
    div.fc-controls > btn fc-edit · label.fc-target>select
      · div.fc-chips (.fc-chips-label + button.fc-chip×n — phone-only target picker; ≤640 CSS hides
        .fc-target and shows the chips: the native select's popup covered the card's controls)
      · a|button.btn-accent (download/convert) · btn copy
      · div.fc-more > button (⋯, aria-haspopup=menu) + div.fc-menu[role=menu] > button[role=menuitem]×≤2
        (save as project · file details; ≤640 the menu spans the card: .fc-more goes static, .fc-controls relative)
      · btn.fc-remove
  dl.fc-details (grid; 1 col ≤640) > div.fc-detail-row > dt/dd  (+GPS → Google Maps link)
  div.fc-optrow > .fc-optrow-label + (.fc-opt-default | span.fc-opt-chip×n > button ×) + button.fc-opt-toggle×1–2
  div.fc-opts.sp-grid > <SettingControl/>×n   (optsOpen)
  div.fc-quality (image jpeg|webp) > input[range .4–1]
  div.fc-progress-row (converting media) > .fc-progress>.fc-bar + .fc-pct
  p.fc-error (t(item.error ?? 'failed') — ConvertError keys) | p.fc-warn(.danger)
```

## SettingsPanel.tsx (32) + SettingControl.tsx (71)

The drawer holds the DEFAULTS for new files (title key `settings`, intro `p.sp-intro` says so). SettingsPanel maps
`SETTING_SECTIONS` × `SETTING_FIELDS` (lib/settingFields, see libs.md) to `<SettingControl field settings onChange>`;
it has no field markup of its own. SettingControl draws one field by `control.type`: select (option text ↔ the
choice's real value, so numbers stay numbers), range (`span.sp-val` = `control.show(value)`), check (label + the hint
as a sibling grid cell); `field.disabled(settings)` greys it, `hintWhen` gates the hint. FileCard reuses it with the
file's effective settings.
Pattern: `label.sp-field > span.sp-label [+span.sp-val] > select|input [+ span.sp-hint]`; checkboxes
`label.sp-field.sp-check`. Mounted ONLY inside `.drawer` (which forces `.sp-grid` to 1 column); App renders a `.drawer-bottom-close`
button after it, and ≤640 the drawer head is sticky with safe-area padding (the top X was unreachable
under phone browser chrome).

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

- **Hero.tsx (47)**: prop `compact` (App passes `items.length > 0`) — `.hero(+.hero-compact) >
  div.hero-fold > div.hero-fold-inner (p.hero-tagline + h1.hero-title>span.hero-accent) + div.feat-row>span.feat×6`.
  Compact folds tagline+title away (grid-template-rows 1fr→0fr transition on `.hero-fold`) and shrinks
  hero padding; feat chips stay. Chips: featTrim/featPaint/featGif/featPdf/featDoc/featQr, coloured
  by `.feat:nth-child(n)` — new chips must extend both the i18n keys (×3) and the nth-child CSS.
  NOTE: `.hero-stage`/`.format-card`/`.fsel`/`.stage-*` CSS still exists but is DEAD — Hero no longer
  renders the conversion stage (format pickers removed on purpose). Don't style them.
- **DropZone.tsx (71)**: `div.dropzone(+.over)(+.dz-compact)[role=button]` wrapping hidden
  `input[type=file multiple]` with `accept={ACCEPT}` (built in lib/formats from every extension detectKind knows);
  optional `onNewNote` renders the `.dz-note` blank-Markdown link (stopPropagation).; drag handlers + click + Enter/Space;
  input value reset after pick so same file re-picks. Prop `compact` (App: items exist) swaps the
  hero layout for a slim row (plus glyph + `dropMore` + kbd hint, `.dz-compact` CSS).
  `.dz-kbd` (Ctrl+V hint) is hidden on touch via `@media (hover:none)`.
- **Overlay.tsx (14)**: `createPortal(div.editor-overlay, document.body)` — invariant 17 lives here.
  Children must stopPropagation. Page scroll behind overlays is locked via `body:has(.editor-overlay)` CSS
  (plus `html:has(.editor-overlay)` with `overflow-y: clip`).
- **ConfirmDialog.tsx (50)**: Overlay + `.editor.mini-modal.confirm-modal[role=alertdialog]` with title, `.confirm-msg`,
  Cancel (`.btn-ghost`, focused on mount) and confirm (`.btn-${tone}`: danger by default, accent for App's OCR download question). Backdrop click and Escape cancel; keydown stops
  propagation so editor shortcuts underneath stay quiet. Used by Studio for every delete.
- **FormatMatrix.tsx (78)**: static 5 cards (image/audio/video/pdf/doc — `.mx-pdf` violet, `.mx-doc` accent) from module const `MATRIX`.
  OUT chips are derived (`outs(IMAGE_OUTPUTS)` … `formatLabel`, documents = the union of `DOC_OUTPUTS`), so a new
  output appears by itself; IN chips are a short hand-picked list (detectKind accepts more).
  The README picture `docs/images/formats-*.webp` comes from `docs/images/formats.html`, whose OUT lists are
  checked against lib/formats by tests/formatsPicture.test.ts.
- **InfoTip.tsx (47)**: `span.info-i` + portal `.tip-pop` (fixed-position tooltip, never clipped).
- **InstallPrompt.tsx (98)**: `.install-card > .install-icon + .install-text + .install-btns`.
  Captures `beforeinstallprompt` (Android/desktop → real install button) or shows the iOS
  Share → Add-to-Home-Screen hint; returns null when standalone or dismissed <14 days
  (localStorage `morphkit-install-dismissed`). Desktop corner card, phone full-width above tab bar.

## Cross-cutting

- localStorage: `morphkit-theme`, `morphkit-settings`, `morphkit-lang`, `morphkit-project`, `mk-layout`, `mk-sort`,
  `morphkit-install-dismissed`, plus one `useSplitter` key per resizable panel (`morphkit-iepw`, `morphkit-stw`,
  `morphkit-vwsw`, `morphkit-vwph`, `morphkit-gifph`, `morphkit-pdfpw`).
- Fixed/sticky inventory: `.m-tabbar`/`.install-card` (z95), `.drawer-overlay`/`.drawer` (z100/101),
  `.editor-overlay` (z110, Overlay + FramePicker), `.st-note` (z150), `.tip-pop` (z300),
  `.trk-head` (sticky left), grain `body::after` (z999).
- Responsive architecture: see `docs/claude/styles.md`.
