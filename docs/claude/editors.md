# Map: ImageEditor, GifEditor, PdfEditor & DocEditor

> On-demand map for AI sessions. Read this INSTEAD of re-reading the source files for
> orientation; grep the names below to jump precisely. Update when structure changes.
> Both render `inline ? body : createPortal(body, document.body)`; all CSS in styles.css.

## ImageEditor.tsx (1685) — raster layer editor

**Model** (invariant 18): immutable `base` (PNG Blob + ImageBitmap in `baseRef`, load-downscaled to
`MAX_DIM = 4096`) defines W×H. Ordered `Layer[]` (index 0 = bottom; panel renders reversed). A layer IS
a canvas: runtime pixels in `pixRef: Map<layerId, HTMLCanvasElement>`; `Layer.src` (PNG dataURL) is the
persisted mirror written by `commitPixels()` after each gesture. `Layer = {id name visible locked opacity
blend mask maskEnabled src}`; `BLEND_MODES` (12 composite ops) exported; masks decode lazily into module
`maskBmpCache`. Transient selection lives in refs only (`maskRef` white-on-transparent canvas, `tintRef`,
`maskBBoxRef`) and can be promoted to a layer mask. History: `HistEntry = {meta: Layer[], pixels:
Record<id,dataURL>, baseBlob, thumb (≤96px via histThumb), label (i18n key of the action that
produced the state — every `pushHist(action)` call site names its action; `lastActionRef` carries
the current state's label through snapshot/applyHist)}`, cap `HIST_CAP = 14`, in histRef/redoRef.
The collapsible `.lp-hist` list (histOpen) renders the FULL timeline — past + current + future
(redo) rows with thumbs + labels; `jumpTo(i)` jumps back and `jumpForward(j)` forward, both
non-destructive (states shuttle between the stacks) — only a new edit (pushHist) clears redoRef.
Zoom is CSS-only (`style.width = w * zoom`) inside scrolling `.ie-viewport`. Version-bump state pattern:
`baseVer pixVer selVer histVer` (refs are authoritative, bumps force render).

**State**: layers · activeId · tool (`pan move pen eraser line rect ellipse arrow text crop wand rectsel
lasso fill`) · color · size (1–40) · fontSize · fontFam (FONT_MAP) · bold · outlineOn · wandTol (5–90, ×4.4 RGB
distance) · wandGlobal (wand matches whole image, not just touched region — `.wand-global` toggle) ·
brushType (pen|marker|highlight) · zoom (0.05–6) · baseVer/pixVer/selVer/histVer · cropSel
{a,b} · selDraft · lassoPts · textEdit {pos,value} · ready · copied · panning · cursor · renaming ·
bgColor/bgOn · resizeOpen · rzMode pct|abs · rzPct · rzW/rzH · **panelOpen (mobile layers
bottom-sheet; ≤720px only — desktop CSS ignores it)** · **panelW (desktop layers-panel width via
`useSplitter('morphkit-iepw', PANEL_DEF, PANEL_MIN 200, PANEL_MAX 520, {invert})` — dragged via
.ie-gutter, dblclick resets, applied as `--ie-panel-w` inline on .ie-layout)**.
**Refs**: canvasRef (.ie-canvas2) · viewportRef · baseRef · histRef/redoRef · scratchRef (mask/blend
compositing) · previewRef (live shape preview) · pixRef · dragRef (gesture tagged union; paint mode
carries an optional `layerId` pinning the stroke to a layer created mid-gesture) · layersRef ·
maskRef/tintRef/maskBBoxRef · antsRef (marching-ants phase) · firstBaseRef · basePromotedRef ·
blankBaseRef (transparent same-size base kept ready by an effect on [ready, baseVer]) ·
moveStoreRef (move tool's per-layer TRUE content + integer offset — pixels dragged past the
canvas edge survive later moves; the layer canvas is the clipped view so composite/copy/export
stay canvas-bound. Session-only: invalidated by any non-move commitPixels, applyHist,
transformLayers, deleteLayer, mergeDown).

**Functions**: pixels/layers `W H layerCanvas activeCtx commitPixels patchLayer applyBg` · render
`paintLayers render composite preview clearPreview` (paintLayers: per-layer scratch → mask
destination-in → opacity+blend) · history `snapshot pushHist applyHist undo redo` · selection
`buildTint deselect floodRegion matchColorGlobal wandSelect commitRectSel commitLasso applyToSelection
(clear promotes a blank base first — invariant 18) maskFromSelection invertMask clearMask` · painting `strokeStyleFor(ctx, erase?) drawShape bucketFill commitText paintCtx looksBlank promoteBase`
(eraser = destination-out; `promoteBase` bakes the base into a bottom layer + swaps in blankBaseRef —
**synchronous on purpose**, fires only when the active layer is blank; see CLAUDE.md invariant 18) · geometry `swapBase
transformLayers applyCrop transform applyResize` (geometry ops re-bake EVERY layer + rewrite src) ·
layer ops `addLayer duplicateLayer deleteLayer moveLayer mergeDown` · IO `importImageBlob copyCanvas save`
(export `${base}_edited.png`) · pointer `toPt startPan onDown onMove onUp cssScale`.

**DOM**:
```
{.ie-inline-wrap | .editor-overlay} > .editor.editor-wide[.ie-inline]
  .ed-head (!inline): .ed-title + .theme-toggle close
  .ed-toolbar: 14 tool-btn (TOOL_ICONS) · sep · rotate/flipH/resize · sep · undo/redo/copy   (wraps ≤640)
  .ed-options (fixed-height nowrap scroller — canvas must never move):
    .opt-tool · .swatches>.swatch×10 · .tb-slider(stroke|font) · .tb-select brush|font · bold/outline
    · .tb-slider tolerance · .wand-global toggle · applyCrop btn · clearSel(accent)/fillSel/deselect btns
    · .opt-spacer · .zoom-ctrl(−/val/+/fit)
  .ie-layout (grid 1fr|262px; 220px ≤900; 1fr ≤720)
    .ie-vpwrap > .ie-viewport(ref, scroll) > .ie-inner{width:w*zoom} > canvas.ie-canvas2 + input.ie-textinput
              + button.lp-fab (mobile-only layers toggle, .on when open) + span.zoom-float (readout)
    div.ie-gutter (desktop col-resize splitter: pointer-captured drag → panelW; hidden ≤720)
    [panelOpen && div.lp-scrim (tap closes sheet)]
    aside.layers-panel[.open ⇒ mobile sheet slides up]
      .lp-colour > .mx-label + <ColorPicker> (.cp > .cp-sv/.cp-hue/.cp-foot>.cp-preview+.cp-hex)
      .lp-hist > button.lp-hist-head (.mx-label + .lp-hist-count + .lp-hist-chev)
        [histOpen && .lp-hist-list > button.hist-item×n (img thumb + step label, newest first,
         onClick jumpTo) | .lp-hist-empty]
      .lp-head > .mx-label
      .lp-ops > button×4 (svg + text label: add/dup/mergeDown/delete — replaced the old glyph-only head buttons)
      .lp-props (active layer): .lp-row opacity range · .lp-row select.lp-blend · .lp-row.lp-mask
      [...layers].reverse(): .lp-layer[.active] > .lp-layer-head (layer-eye, .lp-thumb>img, .lp-name|
        .lp-title>.lp-title-row(+.lp-badge M/lock/dim), .lp-actions (lock ↑ ↓ — hover-revealed,
        always visible on touch))
      .lp-layer.layer-bg-row (permanent bottom: eye, input[color].layer-bg-swatch, title)
  .ed-foot: .kbd-hints (hidden on touch) + .ed-foot-main (cancel !inline · save)
  <Overlay> resize modal: .editor.mini-modal (.ed-seg pct|abs, range | .size-row number inputs + swap)
```

**Interaction notes**: canvas `onDown` does `preventDefault()` (invariant 5) + `setPointerCapture` for
every tool; `.ie-canvas2` has CSS `touch-action:none` → single-finger drag paints. NO pinch zoom
(wheel listener on viewport, passive:false, factor 1.12, cursor-anchored; zoom buttons are the touch
path). Pan = pan tool or middle-button. Window keydown: Ctrl+C/Z/Shift+Z, Delete clears selection,
Escape cancels crop/deselects; window paste imports image or feeds text tool. Marching-ants rAF loop
runs while a selection exists (full-res re-render per frame — perf hazard, keep selections small).
`.ie-textinput` positions via `cssScale()` in CSS px and does NOT reposition on zoom while open.

**Contracts**: props `{item, onSave?, onClose?, inline?, initialLayers?, onLayersChange?, bg?,
onBgChange?, onBaseChange?, importBlob?, onImportDone?}`. Overlay mode: App (item/onSave/onClose).
Inline: Studio passes key={imgBase.id}, initialLayers from `project.imageDoc.layers`, writes back full
imageDoc patches with `objects: []` (legacy object model is dead). Exports: `BLEND_MODES, Blend, Layer,
newLayer, FONT_MAP`. i18n prefixes: `tool_*` + editor keys (see i18n families in libs.md).

## GifEditor.tsx (644) — GIF/APNG frame editor

**Model**: `decodeAnim(item.file)` → `Frame = {bitmap: ImageBitmap, delay, thumb (48px dataURL)}` in
**mutable `framesRef.current`** (not state) — mutations splice in place then bump `ver`; `bitmapsRef`
Set for close() teardown. Captions `Cap = {id text size color x y from to}` with x/y relative 0..1,
dragged directly on the preview canvas, baked at export (stroke-then-fill, IBM Plex Sans 700).
`playOrder()` = range slice + reverse + boomerang tail; `speed` divides delays (preview AND output).
`flatten` + `matte` composite a solid bg (kills alpha). Export: GIF via GIFEncoder + `writeGifFrame`
(keepAlpha = !flatten); APNG via UPNG.encode; yields every 4th frame. NO undo/history. 300-frame cap.

**State**: ver · cur · playing (default TRUE) · range [s,e] inclusive · speed (SPEEDS .5–2) · reverse ·
boomerang · caps · outFmt gif|apng (seeded from srcIsApng) · flatten · matte · note (4s) · busy · loaded ·
`prevSplit` = useSplitter('morphkit-gifph', 40vh-based px, 120–700, axis y) → `--gif-ph` caps the
preview canvas max-height; `.split-gutter.h` sits between preview and transport (hidden ≤760).
**Refs**: canvasRef · framesRef · bitmapsRef · timerRef · posRef · dragCapRef.

**Functions**: `drawCaptions toCanvasPt capAt onCanvasDown/Move/Up` (down pauses playback + capture;
inline `touchAction: caps.length ? 'none' : 'auto'` so caption drag works but scroll passes through
when no captions) · `drawFrame playOrder selectFrame step clampAfterMutate` · `deleteFrame
duplicateFrame moveFrame dedupe` (32px signature merge, sums delays) · `setDelay(ms, all?)` (20–5000) ·
`addCap patchCap removeCap` · `save()`.

**DOM**: `.ed-preview.gif-preview > canvas` → `.gif-transport` (prev/play/next · .gif-pos · sep ·
move ←/→ · dup/del/dedupe btns · .gif-delay number+applyAll; wraps ≤640) → `.strip` (horizontal thumbs
`button.thumb[.active][.dim] > img(h48; 56 touch) + span idx`) → `.banner.info` (note) → `.ed-controls`
(.ed-row range: sp-label + DualRange · .ed-grid: speed/reverse/boomerang/outFormat/flatten/matte ·
.ed-row.cap-panel: addCaption + .cap-row×caps (.cap-text, .num-sm size, color, .num-sm from/to, ×)) →
`.ed-foot` (busy hint · cancel !inline · save). Inline mode has NO .ie-layout — the whole editor scrolls.

**Contracts**: props `{item, onSave (REQUIRED), onClose?, inline?, importFrames?, onImportDone?}`.
App: onSave=saveEditedGif. Studio inline: key={id+blob.size} (remount on blob change — no persisted doc;
saving rewrites the asset blob via replaceAssetBlob). lib: decodeAnim, writeGifFrame, extOf, GIFEncoder,
UPNG. Output `${base}_edited.gif|apng`. Nothing persists between sessions (captions discarded on unmount).

## PdfEditor.tsx (~800) — page-list editor (modal AND Studio inline)

**Model**: `PPage = {id, src: PageSrc, intrinsic, rotate, flipH, flipV, w, h, overlay?, notes, watermark, thumb?}` —
`src` is a tagged union `{kind:'pdf', doc, index}` (doc = key into `docsRef: Map<string, SrcDoc{file, proxy,
password?, encrypted}>`) | `{kind:'image', blob}` | `{kind:'blank'}`. `intrinsic` = the source page's own /Rotate;
`w/h` = display size at rotate 0. Decorations are NON-DESTRUCTIVE and anchored in page USER space:
`overlay` (transparent PNG), `notes: PdfNote[]` (ux/uy fractions), `watermark` flag (doc-level `wm: Watermark`
state). `noteDisplay`/`noteFromDisplay` map user ↔ display (rotation + flips). Thumbs render the page AS IT
EXPORTS (`renderDisplay(p, {width|maxDim, decorate})`) and are cleared (`thumb: undefined`) whenever a page
changes; a lazy effect renders one at a time. Nothing is baked until `save()` → `toSpecs` → `buildPdf`.
Module counters `pageUid`/`docUid`; `THUMB_W 168`, `EDIT_MAX 2200`, `PREVIEW_MAX 1600`, `HIST_CAP 40`,
`DEFAULT_WM`.

**History**: `commit(next)` is THE mutation funnel (snapshots `pagesRef` into `histRef`, clears `redoRef`);
`undo`/`redo`; `histVer` forces re-render. Thumb refreshes and note typing (`patchPage(..., false)`) bypass
history; a note textarea blur commits.

**State**: pages (+`pagesRef`) · sel · anchor · loaded/error/busy/prog/note (flash) · dragIdx/overIdx ·
editing `{pageId, file, base}` (nested ImageEditor; `base` = undecorated render for the diff) · addAt ·
previewOpen (aside stays MOUNTED; `.with-preview` animates its width — never unmount it or the toggle pops) ·
preview `{id, url, w, h}` (of `focusPage` = last selected) · prevSplit (useSplitter 'morphkit-pdfpw' 280–800 →
`--pdf-prev-w` on .pdf-body, dragged via .split-gutter.pdf-gutter, hidden ≤760) · zoomed (full-screen
`.pdf-zoom` lightbox: non-note click on the preview page opens it, Esc/click closes — Esc handler checks
zoomed FIRST) · noteMode · activeNote ·
wm/wmOpen · exportOpen · xo `ExportOpts {scope, split, title, author, encrypt, userPw, ownerPw}` ·
pwAsk `{file, resolve}` (promise-backed password prompt).

**Functions**: `askPassword`/`openWithPrompt` (retry loop over `PdfPasswordError`) · `loadPdfPages(file,
password?)` (pageInfo + readNotes per page; null = user cancelled) · `imagePages` · `wmArt` (memo canvas/bitmap)
· `renderDisplay` · selection `clickPage togglePage` · ops `rotateSel flipSel deleteSel duplicateSel moveSel
reverseAll addBlank pickFiles onFiles` (also fed by the `importFiles` prop) · notes `addNoteAt setNoteText
deleteNote onPreviewClick` · `applyWm(on, scope)` · `editPage` (render undecorated base + shown-with-overlay
file → ImageEditor) → `onPageEdited` (same size ⇒ pixel diff → `displayToUserCanvas` → `overlay`; size changed
⇒ raster image page + `pdfRasterized` flash) · `onThumbDown` (mouse-only drag reorder) · `toSpecs`
(`getPlainBytes` per doc; failure ⇒ plan-B raster spec with notes/overlay re-anchored into display space) ·
`save` (scope/split→ZIP/encrypt; inline saves under the asset's own name). Keys: Del, Ctrl+A/Z/Shift+Z/Y,
←/→ page nav, Esc (note mode first).

**DOM** (portal to body when modal; `inline` renders in place like GifEditor; nested ImageEditor / export
Overlay / PdfPasswordModal are SIBLINGS of the overlay inside the portal — never children):
```
{.editor-overlay | .ie-inline-wrap} > .editor.editor-wide.pdf-editor[.ie-inline]
  .ed-head (!inline): .ed-title (.pdf-lock 🔓 when any source was encrypted) + close
  .ed-toolbar.pdf-tools: add pages · blank · | undo redo | rotL rotR flipH flipV moveL moveR dup reverse |
      draw-on-page · note(.active) · watermark(.active) · .pdf-del · spacer · .pdf-preview-toggle · select all/none
  [wmOpen] .pdf-wm > .pdf-wm-field×n (.pdf-wm-text input · opacity/angle/size ranges · .ed-seg center|tile ·
      .pdf-wm-btns image pick/replace/clear · .pdf-wm-color <ColorPicker>) + .pdf-wm-apply (sel/all/remove)
  .pdf-body[.with-preview] (grid 1fr | 38%; stacks ≤760)
    .pdf-grid[role=listbox] > .pdf-status | .pdf-page[data-idx](.sel .dragging .over-before/.over-after)
        .pdf-thumb > img | .spinner · .pdf-badge(image/blank) · .pdf-badge.rot (90° ↔ ↕) · .pdf-badge.deco (💬 ✎ ◈)
        .pdf-page-foot > .pdf-check(.on) + .pdf-num + .pdf-ins
    .split-gutter.pdf-gutter (drag width) + aside.pdf-preview[aria-hidden] > .pdf-preview-bar (prev · n/total · next · .pdf-dims) + .pdf-preview-stage[.noting]
        > .pdf-preview-page{aspect-ratio} > img + button.pdf-note-pin×n(.active) + [.pdf-notes > .pdf-note-row
        (.pdf-note-idx + textarea + delete)]
  .fc-progress-row.pdf-progress (export) · .ed-foot (.ed-hint summary|flash + cancel(!inline) · pdfSave|pdfSaveAsset)
  input[file pdf+images] · input[file image] (watermark)
Overlay .editor.mini-modal.pdf-export: .pdf-x-row scope .ed-seg · split check (!inline) · title/author ·
  encrypt check → .pdf-x-pw (user/owner password) · pdfDecryptNote · foot
```
i18n: the pdf* key family (+ mergePdf/mergePdfTip in the App batch bar, kindPdf/mxEditPdf in
FileCard/FormatMatrix, typePdf/typePdfDesc/pickPdf in Studio).

## PdfPasswordModal.tsx (~80)

Props `{fileName, onSubmit(pw) → Promise<boolean>, onCancel}`. Owns pw/show/busy/wrong; the CALLER verifies
(pdf.js open) and returns false to keep the modal open (`.pw-modal.shake` + `.pw-err`). Autofocus, Enter submits,
Esc cancels. DOM: Overlay > .editor.mini-modal.pw-modal > .mx-label + .pw-file + .pw-row (.pw-input + eye
toggle) + .pw-err|.ed-hint + .ed-foot.

## DocEditor.tsx (~150) — source + preview for documents

Props `{item, onSave(id, file), onClose}`. On mount `docEditSource(file)` picks the edit `mode`
(`md` for .md, .txt AND .docx/.pptx, `html`, `csv` (first sheet, `sheetName`), `json`, `text`) and the source text;
`previewHtml(mode, text)` re-renders 250 ms after typing into `.doc-prose` (already sanitized by lib/docs).
State: mode · text · orig (dirty check) · sheetName · html · loaded/error/busy · view split|source|preview · wrap.
`save()` → `docSave(original, mode, text, sheetName)` regenerates the ORIGINAL format (docx/xlsx rebuilt) →
App saveEditedDoc (replaces the item file, status ready, like images). Keys: Tab inserts \t, Ctrl+S saves, Esc closes.
DOM: `.editor-overlay > .editor.editor-wide.doc-editor.view-* > .ed-head + .ed-toolbar.doc-tools (.chip mode ·
hints · .ed-seg view · wrap) + .doc-body (textarea.doc-source | .doc-preview > .doc-prose) + .ed-foot (docStats)`.
i18n: doc* keys (docSource docSplit docWrap docStats{words,lines,chars} docUnsaved docLoadError docDocxHint docSheetHint).

## SheetEditor.tsx (~330) — spreadsheet grid (modal)

Routed by App for `docTypeOf(file) === 'sheet'`. Model: `info: SheetInfo` (all sheets) + `rows: Cell[][]`
(ACTIVE sheet, padded to ≥12×4 plus one spare row/col — typing into the spare grows the grid; `trim` strips
empties on flush). `flushInto` writes the active grid back into `info` on sheet switch/save. Ops:
`setCell` (coerces numbers/booleans), insert/delete/move row+col, `sortByCol` (row 1 pinned as header),
undo (50 snapshots, Ctrl+Z), add/delete/rename sheets (double-click a tab; csv/tsv = single fixed tab).
Nav: Enter/Tab/arrows via `focusCell` on `input[data-r][data-c]`; PAGE=300 row windows + `.sheet-more`.
Save: csv/tsv → text of the active sheet; else `sheetsToXlsx` (xls/ods renamed .xlsx) → the App doc-save path.
DOM: `.editor.editor-wide.sheet-editor > .ed-toolbar.sheet-tools + .sheet-tabs (.sheet-tab.active
.sheet-add .sheet-del .sheet-rename) + .sheet-grid (table, sticky thead th + tbody th, td>input.num,
tr.sh-header, .sh-corner, th/td .sel) + .ed-foot (shStats)`. i18n: sh* keys.

## QrTool.tsx (~330) — QR maker/reader (modal)

Props `{initialDecoded?, onAddImage, onClose}` — a FileCard QR chip opens it on READ with the payload.
MAKE: `tpl` url|text|wifi|vcard|mail (payload built by lib/qr `payloads`), style `QrStyle` {fg, bg
(''=transparent), size 128–2048, margin, ecl, logo (forces ecl H)}; 150 ms-debounced preview via
`qrToCanvas`; actions download PNG (`qr-<host|tpl>.png`)/SVG, copy PNG, `onAddImage` → converter list.
READ: `.qr-drop` (drop/click/paste; paste listener active on the read tab only), `startCam`/`stopCam`
(getUserMedia environment cam, 250 ms `decodeFrame` loop, tracks stopped on close), result =
`classifyPayload` chip + textarea + open-link (url) / copy / remake. DOM: `.editor.editor-wide.qr-tool >
.ed-head (.qr-tabs) + (.qr-make (.qr-form .qr-tpl .qr-field .qr-text .qr-style .qr-colors) | .qr-preview
(.qr-canvas[.checker] .qr-payload .qr-actions)) | (.qr-read (.qr-drop .qr-video .qr-read-actions
.qr-result .qr-decoded .qr-kind))`. i18n: qr* keys.
