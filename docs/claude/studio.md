# Map: Studio, Mixer, VideoWorkspace, MediaEditor

> On-demand map for AI sessions. Read this INSTEAD of re-reading the source files for
> orientation; grep the names below to jump precisely. Update when structure changes.
> Type shapes (Clip/Track/MixerDoc/ProjectRec/AssetRec, empty* factories, uid) live in
> `lib/studioTypes.ts`; audio graph in `lib/audioEngine.ts` (see docs/claude/libs.md).

## Studio.tsx (1110) — projects shell + persistence broker

Two mutually exclusive trees in one component: **launcher** (early return when `!entered`, ~line 688)
and **workspace** (~line 821). Only component touching IndexedDB.
Prop `enterProjectId?` (from App's "open as project"): init effect jumps straight into that
workspace, skipping the launcher; App clears it on manual studio-toggle.

**State**: projects · curId (mirrored to localStorage `'morphkit-project'`) · assets (sorted by addedAt) ·
bufVer (bump after decodes → waveform redraw) · activeTrackId (lifted, shared Mixer/VideoWorkspace) ·
entered · pickType · pjStats {id:{n,bytes}} · thumbs {id:{url,video}} · layout grid|list (`'mk-layout'`) ·
sortBy (`'mk-sort'`) · metaPj · metaFacts {id, name, meta: FileMeta} (info-modal probe, keyed by project
id so a slow probe can't paint another project's rows) · blankOpen · imgImport (Blob→ImageEditor.importBlob) · gifImportFrames ·
framePick {blob, mode} · note (5s flash) · dropHot · bcW/bcH (blank canvas, default 1280×720) ·
`assetsSplit` = useSplitter('morphkit-stw', 252, 180–460) → `--st-assets-w` on .st-body + .split-gutter.
**Refs**: importRef, pjImportRef, saveTimer (500ms putProject debounce), `curRef` (fresh project across
rapid patches — invariant 14), persistedRef (untouched new projects dropped on exit), thumbUrlsRef,
baseSaveTimer (600ms raster-base debounce).

**Functions**: `primaryAsset(p, list)` (module: wired-in base/gif/video asset, else first image/video —
shared by the thumb effect and the info modal) · `openMeta(p)` (probes the primary asset via
`extractMeta`, drops the blob preview per invariant 2) · `metaRows` (useMemo: **per-type** info rows —
audio/video get tracks+clips+timeline, video adds dims/duration/trim, image adds canvas/layers/bg,
gif adds dims; never show track counts on an image project) ·
`flattenImageProject` (≤320px launcher thumb) · `savePatch(patch)` — THE mutation funnel
(merge curRef → setProjects → debounced putProject) · `leaveWorkspace` · `patchVideoDoc(fn)` ·
`createProject`/`removeProject`/`renameProject` · `importFiles` · `removeAsset` (must strip clips +
`dropAssetBuffer` — invariant 11) · `downloadAsset` · `replaceAssetBlob` · `exportAsset` ·
`withClip`/`addToMix` · `onRecorded` (rec_*.webm asset → addToMix) · `onAudioExtracted` (extracted WAV →
`*_audio.wav` asset + its own track at timeline 0, becomes active) · `newFromAsset` (delegates to
idb `createProjectWithAsset`, then enters) · `blankCanvas`
(clamp 8–4096) · `blankGif` (480×360) · `remapMixer` + `exportProjectZip`/`importProjectZip` (id remap) ·
`importAssetToEditor` (routes by ptype; video→framePick modal; GIF→decodeAnim; GIF→MP4 via convertMedia,
15MB cap `tooBigGif`) · `dropExternalToEditor` · `onFramesPicked` · `pseudoItem(a)` (**memoized** pseudo-Item
for inline editors — invariant 15) · `persistBase`. Window `paste` listener while entered.

**Launcher DOM**: `.studio.st-launcher > .st-bar (h2.launcher-title, InfoTip, .opt-spacer, select.tb-select,
.st-tabs grid|list, import btn)` + `.pj-grid|.pj-list > .pj-card (button.pj-open > .pj-thumb + .pj-body
(.type-badge.tb-{type}, .pj-name, .pj-meta)) + .pj-actions (info/export/delete)` + `.pj-card.pj-new` ·
Overlay→`.editor.type-modal > .pj-grid > .pj-card.pj-type×4` · Overlay→`.editor.mini-modal` (metadata dl, rows from `metaRows`).

**Workspace DOM**: `.studio > .st-bar (back btn, .type-badge, input.st-name, spacer, export/delete)` +
`.st-body (resizable assets | .split-gutter | 1fr grid; 1fr ≤760) > aside.st-assets (drop target; .asset-row[draggable] > .asset-icon
+ .asset-name + .asset-size + .asset-btns (＋ addToMix · ◎ pickBase/pickGif/pickVideo · import-to-editor ·
new-from-asset · download · ×)) + main.st-main[.drop-hot] > .view-anim key={ptype+curId} >
(Mixer | picker-panel/ImageEditor-inline | picker-panel/GifEditor-inline | VideoWorkspace)` ·
portal `.banner.info.st-note` · FramePicker · Overlay→`.editor.mini-modal.canvas-modal` (preset-grid + size-row).

**Notes**: asset→canvas drag is HTML5 DnD (`application/x-morphkit-asset`) — no touch support; the
import-to-editor button is the touch path. `.studio` is a fixed-height workspace on desktop
(`calc(100vh-96px)`), but ≤760px it switches to `height:auto` and the page scrolls (see styles.md).

**Child props**: `<Mixer doc onChange onRecorded bufVer names activeTrackId onActiveTrack>` ·
`<VideoWorkspace videoAsset candidates doc onDoc onRecorded bufVer names activeTrackId onActiveTrack projectName>` ·
`<ImageEditor inline key={imgBase.id} item initialLayers bg onLayersChange onBgChange onBaseChange onSave importBlob onImportDone>` ·
`<GifEditor inline key={id+blob.size} item onSave={replaceAssetBlob} importFrames onImportDone>`.

## Mixer.tsx (468) — multi-track timeline

**Module constants — keep in sync with CSS**: `HEAD_W = 172` ↔ `.trk-head{width:172px}` (also
`.mix-empty` padding-left 192 = 172+20) · `LANE_H = 72` ↔ `.lane{height:72px}` (vertical drag→track
quantiser) · ClipWave canvas height 52 · ruler 30px (`.tl-ruler`, `.tl-corner`, `.playhead{top:-30px}`).
`.lane`'s 80px repeating-gradient grid only aligns at zoom=80. **Never change one side alone.**

**State**: zoom (px/sec, default 80, clamp 8–400) · sel (clip id) · playing · playPos · recording ·
recElapsed (100ms tick) · busy · err (mic denied, 4s clear).
**Refs**: handleRef (PlayHandle) · rafRef · recRef (MediaRecorder) · recTimerRef · scrollRef (.tl-scroll,
fit() measures) · fitDoneRef (auto-fit once) · dragRef {mode:'move'|'l'|'r', clipId, startX, startY,
origTrackIdx, orig} · docRef (fresh doc during pointermove bursts).

**Functions**: `commit(fn)` — single mutation funnel → onChange · `fit()` · `patchTrack`/`removeTrack`/
`addTrack` · `patchClipById`/`relocateClip`/`removeClip`/`splitSelected` · `stop`/`togglePlay` (rAF tick
vs `audioCtx().currentTime - h.t0`) · `toggleRecord` (getUserMedia→MediaRecorder) · `exportWav`
(renderMixWav → mix.wav) · `clipDown(mode, trIdx, c)` (stopPropagation + preventDefault + setPointerCapture) ·
`clipMove` (dx/zoom; move also `round(dy/LANE_H)` picks target track) · `seekFromRuler` · window keydown
Delete/Backspace (skips inputs). `ClipWave` = module sub-component, canvas from `peaks()`.

**DOM**: `.mixer > .gif-transport (play-btn, rec-btn[.recording], InfoTip, .gif-pos[.rec-time], sep,
addTrack, split, .zoom-ctrl(−/val/+/fit), .opt-spacer, export WAV)` + `.banner.danger?` +
`.tl-scroll > .tl-inner{width: laneW+HEAD_W} > .tl-row(.trk-head.tl-corner + .tl-ruler>.tick[.major]×n)
+ .tl-body > .tl-row[.active]×tracks (.trk-head(sticky left; input.trk-name, .trk-btns M/S/×,
input.trk-gain) + .lane > .clip[.sel]{left:start*zoom, width:duration*zoom} (canvas.clip-wave,
.clip-name, .clip-edge.l/.r)) + p.mix-empty + .playhead{left: HEAD_W+pos*zoom}`.

**Touch**: `.clip` has touch-action:none + pointer capture (drags work). `.tl-ruler`/`.lane` deliberately
have NO touch-action — touch-drag there must keep scrolling the timeline; ruler seek is tap-only.
`.clip-edge` widened to 14px + visible tint on touch via media queries.

## VideoWorkspace.tsx (~185)

Props: videoAsset|null, candidates, doc: VideoDoc, onDoc(fn) (functional patch), onRecorded,
onAudioExtracted(wav, srcName), bufVer, names, activeTrackId, onActiveTrack, projectName.
State: duration (loadedmetadata; back-fills trimEnd once) · busy · prog · note (extract failure, 4s) ·
`sideSplit`/`prevSplit` = useSplitter('morphkit-vwsw' 200–460 / 'morphkit-vwph' 140–600 axis y) →
`--vw-side-w`/`--vw-ph` vars on .vw-top + two .split-gutter elements (side width, preview height).
Memo `url` objectURL (revoked). `onTrim(s,e)` scrubs `video.currentTime` to the moved handle (never
seek-back — invariant 13). `extract()` = `extractAudio(file, trimStart, trimEnd||duration)` →
onAudioExtracted (catch → `extractNoAudio` note); shares `busy` with export.
`exportMp4()` = optional renderMixWav → `muxVideo(file, wav, trimStart, trimEnd, loadSettings(), setProg)`
→ `{projectName}.mp4` (name sanitised). Audio timeline aligns to TRIMMED video start (invariant 16).
DOM: `.vw > .vw-top (minmax(0,1fr)|gutter|side, resizable; 1fr ≤760) > .vw-preview(video[controls
playsInline] | .vw-pick picker) + .split-gutter + .vw-side (sp-label+InfoTip, sp-val, DualRange,
.vw-extract(btn+InfoTip), .vw-note?, export btn, .fc-progress)` + `.split-gutter.h` + `<Mixer>`.
`.vw-preview` height var(--vw-ph, 34vh) (26vh ≤640).

## MediaEditor.tsx (276) — converter-queue A/V edit modal

Portaled modal (createPortal direct, not Overlay). Collects a sparse `MediaEdit` for one Item —
never touches bytes. Props `{item, onSave(id, edit|undefined), onClose}`.
State: duration, start, end, volume (0–2, previewed clamped ≤1), speed (SPEEDS 0.5–2), rotate
(live inline `transform: rotate()` on the video; 90/270 append `scale(rotScale)` — a layout
effect on [rotate, duration] fits the rotated bbox into the fixed-height stage via stageRef,
else sideways video overflows it), mute, audioTrack (File|null; forces mute false,
disables the checkbox). Refs: mediaRef, audioPickRef, stageRef. State also: rotScale.
Functions: `onLoaded` · `onTime` (pause at end−0.02, NO seek-back — invariant 13) · `onTrimChange`
(pause + scrub to moved handle) · `markStart`/`markEnd` (0.1s guard) · `playFromStart` · `reset` ·
`save` (emit only non-defaults: trimStart if >0.05, trimEnd if < duration−0.05; rotate/mute/audioTrack video-only).
DOM: `.editor-overlay > .editor > .ed-head + .ed-preview.media-preview.mp-video|.mp-audio (fixed height:
42vh/84px, 34vh ≤640 — fixed so trim updates never shift layout) + .ed-controls (.ed-row trim: sp-label,
DualRange, .ed-mark-btns×3 · .track-sec video: speed select + .ed-seg rotate×4 · .track-sec audio:
volume range, speed (audio-only), mute check, .replace-row picker) + .ed-foot (reset · cancel/save)`.
No Escape handler, no focus trap. Rotation 90/270 visually overflows the fixed stage (known).
