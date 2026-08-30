# Map: styles.css (~3800 lines) + responsive architecture

> On-demand map for AI sessions. styles.css is the ONLY stylesheet (design system
> "Cyberdeck" — neon tech + every component's CSS). Grep the `/* ============ name ============ */`
> banners to jump. Update this file when adding sections or breakpoints.

## Section order (banner names, top → bottom)

1. `:root` tokens + `[data-theme='light'|'dark']` palettes (bg/bg-raised/bg-sunken/panel/line/
   line-strong/ink/ink-dim/ink-faint/mark-bg/accent/accent-soft/**accent-ink (text on accent)**/
   **paint-red/blue/yellow/green/violet (signal palette)**/weave/danger/warn/ok/shadow/**glow
   (neon box-shadow)**) · dark = deep-space navy, surfaces step up clearly (contrast rule) ·
   fonts: display=Chakra Petch(+Noto Sans CJK), body=IBM Plex Sans(+TC/JP), mono=IBM Plex Mono ·
   radii 6/10 (--wobble-sm/-lg are legacy aliases, now sharp) · body 15px + **circuit-grid
   background (var(--weave) graph lines, 28px)** · `body::after` CRT scanlines (fixed, z999) ·
   native `select` fix
2. `top bar` — .topbar .brand .brand-name .topbar-actions .lang-switch .theme-toggle
3. `hero` — .hero (**overflow:hidden — the floor/orb pseudos are wider than phone viewports**)
   + synthwave floor `.hero::before` (perspective grid, gridFlow anim) +
   drifting neon orbs `.hero::after` (orbDrift) · .hero-tagline (mono terminal prompt,
   ::before '>' + ::after blinking cursor) /.hero-title (clamp 36–54px)/.hero-accent
   (glow text-shadow + RGB-split glitch ::before/::after via `data-text` attr, glitchA/B
   keyframes) · **DEAD**: .hero-stage .format-card .stage-* .fsel (Hero no longer renders
   the stage — don't style these) · .hero-cta
4. `buttons` — .btn (**::after = hover sheen sweep; position:relative + overflow:hidden**)
   .btn-accent (gradient accent→violet, --accent-ink text, --glow hover) .btn-ghost .btn-lg
   .btn-sub (.btn-sm lives near matrix section)
5. `workbench` — .workbench .dropzone (**HUD corner brackets = 8 background gradients,
   --dz-b/--dz-l**) .dz-glyph .dz-title .dz-hint
6. `banners` — .banner .danger/.warn/.info/.note .spinner
7. `batch bar` — .batch-bar .bb-info .bb-count .bb-progress(.bb-bar) .bb-done .bb-actions
8. `file list` — .file-card(.status-*) .fc-main .fc-icon .fc-thumb .fc-meta .fc-name .fc-info
   .fc-kind .fc-size .fc-controls .fc-target .fc-remove .fc-detail-btn
9. `details / quality / progress / warnings` — .fc-details .fc-detail-row .fc-quality .fc-progress
   .fc-bar .fc-progress-row .fc-pct .engine-* .fc-error .fc-warn
10. `settings drawer` — .drawer-overlay(z100) .drawer(z101, min(380px,92vw), right sheet)
    .drawer-head; `.drawer .sp-grid → 1fr` (drawer forces single column)
11. `settings fields` — .settings-panel .sp-section .sp-sec-title .sp-grid(minmax 190px) .sp-check
    .sp-field .sp-label .sp-val .sp-hint
12. `format matrix` — .matrix .matrix-title(+::after brush dash) .matrix-grid(minmax 250px)
    .mx-card(+.mx-image/.mx-audio/.mx-video pigment top borders, set in FormatMatrix.tsx)
    .mx-head .mx-icon .mx-kind .mx-label .mx-chips .chip(.out) .mx-arrow .mx-edit
13. `hero feature row` — .feat-row .feat(nth-child pigments) · .fc-edited · .btn-sm
14. `editors (shared shell)` — .editor-overlay(z110, fixed grid-center, padding 20) .editor
    (min(760px,100%), max-height calc(100vh−40px), scrolls) .editor-wide(980) .ed-head .ed-title
    .ed-preview .media-preview.mp-video(42vh)/.mp-audio(84px) .gif-preview .track-sec .replace-row
    .ed-controls .ed-row .ed-grid(minmax 170px) .ed-mark-btns .ed-seg .ed-input .ed-foot .ed-foot-main .ed-hint
15. `dual range` — .dual .dual-track(h26, **touch-action:none required**) .dual-fill .dual-handle(16px) .dual-labels
16. `image editor` — .ed-toolbar(nowrap scroll; wraps ≤640) .ed-options(**intentionally nowrap
    fixed-height scroller — canvas must never move**) .opt-tool .opt-spacer · kbd/.kbd-hints/.dz-kbd ·
    .tool-btn(34px; 40 touch) .tb-sep .tb-color .swatches .swatch · .lp-colour .cp .cp-sv .cp-hue
    .cp-foot .cp-preview .cp-hex (ColorPicker) · .tb-slider · .ie-stage/.ie-canvas/.ie-overlay (legacy) ·
    .ie-textinput · `image editor v2`: .ie-layout(1fr | 8px .ie-gutter | min(--ie-panel-w,42vw)
    resizable 3-col; 1fr ≤720) .ie-gutter(col-resize splitter, touch-action:none, hidden ≤720) ·
    .split-gutter(generic splitter, same look as .ie-gutter; .h variant = row-resize 8px tall;
    hidden ≤760 — all driven by lib/useSplitter; .ie-layout column collapses to minmax(0,1fr) under the SAME condition as the layers sheet — width-only left landscape phones a dead 262px column)
    .ie-vpwrap .zoom-float
    .ie-viewport(max-h 54vh) .ie-inner .ie-canvas2(**touch-action:none**, checkerboard bg) .zoom-ctrl
    .zoom-val · .layers-panel(max-h 54vh) .layer-* .lp-head .lp-ops(labeled layer-ops grid ×4)
    .lp-hist/.lp-hist-head/.lp-hist-list/.hist-item(undo-history list) .lp-props .lp-row .lp-blend .lp-mask-btns
    .lp-layer .lp-layer-head .lp-title .lp-thumb .lp-actions(**hover-revealed; forced visible on touch**)
    .lp-name .lp-badge .lp-obj .layer-bg-row · `canvas size modal`: .canvas-modal .preset-grid .preset
    .size-row .size-field
17. `gif editor v2` — .gif-transport(nowrap scroll; wraps ≤640) .play-btn .gif-pos .gif-delay ·
    .strip(horizontal film strip) .thumb(.active/.dim) · .tb-select .cap-panel .cap-row .cap-text
    .num-sm .cap-dash
18. `pdf editor` — .pdf-editor(flex column) .pdf-tools(wrapping toolbar; .pdf-del hover = danger)
    .pdf-grid(auto-fill 150px, max-h 58vh scroller; ≤640 112px + flex:1 inside a 100dvh sheet) .pdf-status
    .pdf-page(.sel glow · .dragging · .over-before/.over-after neon drop bar) .pdf-thumb(aspect-ratio inline)
    .pdf-badge(.rot .deco) .pdf-page-foot .pdf-num .pdf-check(.on) .pdf-ins(28px on coarse pointers) .pdf-progress ·
    .pdf-body(1fr|auto|auto grid; .with-preview shows the aside — width min(--pdf-prev-w,46vw) animates,
    closed = width 0 still mounted; 1 col ≤760) .pdf-gutter(splitter; hidden ≤760) .pdf-preview(64vh) .pdf-preview-bar .pdf-dims
    .pdf-preview-stage(.noting crosshair) .pdf-preview-page(.zoomable zoom-in cursor; img pdfPrevIn fade)
    .pdf-zoom(z140 lightbox + .pdf-zoom-close) .pdf-note-pin(.active) .pdf-notes .pdf-note-row(.active)
    .pdf-note-idx · .pdf-wm(auto-fit grid) .pdf-wm-field(.pdf-wm-text .pdf-wm-color) .pdf-wm-btns .pdf-wm-apply ·
    .pdf-export .pdf-x-row .pdf-x-pw · .pw-modal(.shake, pwShake keyframes) .pw-file .pw-row .pw-input .pw-err ·
    .pdf-lock .fc-lock(.open) · inline: `.editor.ie-inline.pdf-editor` flex column, grid+preview fill ·
    `.mx-pdf` + `.file-card.kind-pdf .fc-icon` violet live in the format-matrix section
19. `sheet editor` — .sheet-editor .sheet-tools .sheet-tabs .sheet-tab(.active .sheet-add .sheet-del)
    .sheet-rename .sheet-grid(58vh scroller; sticky thead th top / tbody th left, .sh-corner z3; td input
    transparent, .num right-blue; .sel outlines; tr.sh-header tint) .sheet-more · ≤640 100dvh sheet, 16px inputs
20. `qr tool` — .qr-tool .qr-tabs .qr-make(1fr|300px; 1 col ≤760, preview first) .qr-form .qr-tpl .qr-field
    .qr-text .qr-style .qr-colors .qr-preview .qr-canvas(.checker) .qr-payload .qr-actions · .qr-read .qr-drop
    (.drop-hot) .qr-video .qr-read-actions .qr-result .qr-decoded .qr-kind(-url) · .fc-qr chip · .dz-note ·
    ≤640: topbar .qr-btn hidden; .qr-overlay z90 (< .m-tabbar z95 → the QR tab stays tappable and toggles
    the sheet), sheet 100dvh w/ safe-area padding-top + bottom clearance, sticky head, .qr-foot close;
    .m-tabbar = repeat(4,1fr) — the rule lives in the MOBILE LAYER (an earlier-section override loses the cascade)
21. `doc editor` — .doc-mdbar(2nd toolbar row, position:relative for popovers) .mdb-btn(.mdb-wide) .md-heading
    .md-pop(.md-pop-qr) .md-grid/.md-cell(.on hover-picker) · `.editor.ie-inline.doc-editor` (Studio text projects: flex column, .doc-body fills) · .doc-editor(.view-source/.view-preview collapse to one pane) .doc-tools .doc-body(2-col grid,
    58vh; ≤760 two rows; ≤640 100dvh sheet) textarea.doc-source(mono, tab-size 2) .doc-preview(always-light sheet)
    .doc-prose(readable prose: h1–h4, code/pre, blockquote, table scroller, img) · `.mx-doc` + `.file-card.kind-doc .fc-icon`
    accent live in the format-matrix section
22. `studio` — desktop collapse: `.st-body:has(.st-assets.collapsed)` → max-content column, gutter + stats
    hidden · focus (≤760): .st-assets = fixed bottom sheet (translateY ↔ not-.collapsed, animation:none,
    72px FAB clearance) + .st-fab(.on, .st-fab-n badge) + .st-scrim + floating `.ed-foot` save pill,
    .st-export/.st-del/.type-badge hidden · .studio-toggle · .app.studio-mode(full-bleed) · .studio(**desktop: fixed height
    calc(100vh−96px); ≤760: height auto, page scrolls**) .st-bar .st-name
    .st-body(min(--st-assets-w,40vw)|8px .split-gutter|1fr, resizable; 1fr ≤760)
    .st-assets .st-main .view-anim .mixer .media-view .st-assets-head .st-import .st-empty .asset-row
    .asset-icon .asset-name .asset-size .asset-btns · `mixer timeline`: .rec-btn .tl-scroll .tl-inner
    .tl-row .trk-head(**sticky left, 172px = HEAD_W in Mixer.tsx — never change one side alone**)
    .tl-corner .trk-name .trk-btns .trk-gain .tl-ruler(30px) .tick .tl-body .lane(**72px = LANE_H**)
    .clip(**touch-action:none**; tracks cycle pigments via .tl-row:nth-child — row 1 is the ruler)
    .clip-wave .clip-name .clip-edge(8px; 14 touch) .mix-empty(padding-left
    192 = HEAD_W+20) .playhead(top:-30px) · themed scrollbars group · `project launcher`: .st-launcher
    .launcher-title .pj-grid(minmax 230px) .pj-card .pj-open .pj-name .pj-meta .pj-actions .pj-new ·
    `typed projects`: .type-badge .tb-audio/image/gif/video .pj-type .type-icon .picker-panel .picker-list ·
    `inline editors`: .ie-inline-wrap .editor.ie-inline(flex column, overflow hidden, viewport fills) ·
    `video workspace`: .vw .vw-top(1fr|8px .split-gutter|min(--vw-side-w,44vw); 1fr ≤760)
    .vw-preview(var(--vw-ph, 34vh) via .split-gutter.h; 26vh ≤640) .vw-side .vw-extract .vw-note ·
    `launcher v2`: .pj-thumb .pj-body .pj-list .type-modal .mini-modal .meta-list .rz-grid .bg-check
    .vw-pick .frame-modal .fp-preview(240px; 180 ≤640) .st-note(fixed toast z150, safe-area aware) ·
    .footer-link · .st-tabs · `media view`: .media-grid .media-card .media-thumb .media-name .media-actions ·
    `info tooltip`: .info-i .tip-pop(fixed z300)
23. `footer` — .footer
24. `pwa / app shell` — .install-card (fixed corner card, z95; phone: full-width above tab bar)
    .install-icon .install-text .install-btns · .m-tabbar (base display:none — shown ≤640 in the
    mobile layer) · .wand-global lives in section 16 (text tool-btn, width:auto)
25. `shared motion` — `rise` keyframes (**end frames MUST be `transform:none`** — invariant 17)
26. `responsive & motion` + **mobile optimization layer** (see below)
27. `micro-interactions` — tap-highlight, :active press, focus-visible, .drop-hot, modalPop,
    `prefers-reduced-motion` (last block in file)

## Responsive architecture (all breakpoints, why)

| Query | What |
|---|---|
| `≤900px` | .ie-layout side panel 262→220px |
| app-mode: `≤760px, OR ≤540px tall, OR coarse+≤920px` (= APP_MQ in Studio.tsx) | .st-body + .vw-top collapse to `minmax(0,1fr)` — NEVER bare `1fr`: min-content of wide workspaces (mixer/pdf) blows the track past the screen, and the rule must repeat `.st-body:has(.st-assets.collapsed)` or the desktop max-content collapse template outranks it; .split-gutter hidden; pdf-body + doc-body stack; **.studio → height:auto (page scrolls like a normal mobile page)**; .st-assets max-height 30vh; inline .layers-panel 32vh |
| `≤720px` OR `≤540px tall` OR coarse-pointer ≤920 (image editor) | **.layers-panel → fixed bottom sheet** (translateY 105% ↔ .open, z130, 62dvh) + .lp-scrim (z129) + .lp-fab shown (toggle lives in ImageEditor.tsx panelOpen state); inline .ie-viewport bumps to 56vh |
| `≤640px` OR `≤540px tall` OR coarse-pointer ≤920 (image editor) | `.editor-overlay > .editor:has(.ie-layout)` → **100dvh GRID, paint-app style** (short-viewport variant also resets overlay padding, editor max-width/height/radius, hides .ie-gutter): areas 'head head'/'rail canvas'/'rail options'/'foot foot', 50px left column; `.ed-toolbar` = vertical scrolling tool RAIL, `.ed-options` thin bottom strip, `.kbd-hints` hidden; .ie-viewport flex + .ie-inner margin:auto centers the canvas |
| app-mode (inline image editor) | `.editor.ie-inline:has(.ie-layout)` → same rail grid (no head row); rail `max-height: calc(42vh + 58px)` so it scrolls instead of sizing its grid row (56vh + 58px ≤720); `.ie-layout`/`.ie-vpwrap`/`.ie-viewport` height:100% — the viewport fills its 1fr row (fixed vh left a dead band above the options strip) |
| `≤640px` OR `≤540px tall` OR coarse-pointer ≤920 (gif/video modals) | `.editor:has(.gif-preview)` / `:has(.mp-video)` → 100dvh flex column: preview flexes to own the screen, transport + film strip / trim stay pinned, `.ed-controls` scrolls in place (26vh gif / 44vh video cap); audio keeps the plain sheet |
| app-mode (studio focus) | `.st-focus-btn` shows (hidden on desktop); `.studio.st-focus` hides `.st-assets`+`.split-gutter`, `body:has(.studio.st-focus)` hides `.topbar`/`.m-tabbar`/`.footer` — workspace owns the screen; `.studio.st-focus` min-height 100dvh−24 (reclaims hidden chrome) + `.st-main` padding-bottom 52px reserves the FAB / save-pill strip |
| app-mode (studio assets) | `.st-assets-toggle` chevron shows; `.st-assets.collapsed` keeps only the head row (phones start collapsed); `.editor.ie-inline .ed-foot .btn` compacted (export button) |
| `≤720px` (layers sheet) | **`.layers-panel.open` selector must ALSO match `.editor.ie-inline .layers-panel.open`** — the inline base selector is (0,3,0) and otherwise wins, leaving the sheet stuck off-screen; the open sheet is flex column with `.lp-colour`/`.lp-hist` ordered last so layer rows come first |
| `≤720px` | .ie-layout → 1 column (layers panel stacks below canvas) |
| `≤640px` (phone) | .app gutter 16px; .topbar wraps; hero compact; dropzone compact; .bb-actions full-width grow; file-card controls grow + .fc-details 1col; .fc-target hidden →
.fc-chips target chip row shown (native select popup covered the card); **modal editors become full-width sheets** (.editor-overlay padding 0, .editor 100% wide, radius 0, safe-area padding, 100dvh cap); .media-preview.mp-video 34vh; .ie-viewport/.ie-canvas 44vh + .layers-panel 240px; .ed-toolbar + .gif-transport wrap into rows (.ed-options stays a nowrap scroller on purpose); drawer + studio compact; **text/number inputs + selects → 16px font (iOS focus-zoom guard)**; .fp-preview 180px; .vw-preview 26vh |
| `≤640px` (app tabs) | `.m-tabbar` → fixed bottom grid ×3 (z95, safe-area padding); `.studio-toggle` hidden (tab bar owns mode switching); `.app`/`.app.studio-mode` get padding-bottom clearance; `.st-note` + `.install-card` raised above the bar |
| `@media (display-mode: standalone)` | installed PWA: `.footer` hidden; `.topbar` padding-top honors `env(safe-area-inset-top)` (22px desktop / 14px ≤640) |
| `≤400px` | gutter 12px, hero-title 34px, lang buttons tighter |
| `@supports (height:100dvh)` | .studio/.st-launcher/.editor/.type-modal switch to dvh (mobile URL-bar resize) |
| `@media (hover:none)` | .lp-actions always visible; .clip-edge tinted; .kbd-hints/.dz-kbd hidden |
| `@media (pointer:coarse)` | .tool-btn 40px, dual-handle 22px, swatches 18px, clip-edge 14px, layer/track buttons enlarged, .btn min-height 40px, thumbs 56px, overscroll-behavior:contain on scrollers |

Also: `body:has(.editor-overlay), body:has(.drawer-overlay) { overflow:hidden }` (scroll lock) ·
`.st-note` bottom uses `env(safe-area-inset-bottom)` · viewport meta has `viewport-fit=cover` (index.html) ·
**html/body: `overflow-x: clip` (+hidden fallback) and `overscroll-behavior-x: none`** — the page
never pans sideways (a horizontal drag would trigger the browser's back/forward swipe); horizontal
strips (.ed-options/.ed-toolbar/.gif-transport) get `overscroll-behavior-x: contain` on coarse pointers.

## Rules when touching CSS here

1. New component styles go inside the matching banner section; new breakpoint rules go in the
   mobile layer (section 21) so they win the cascade.
2. Never shrink `.trk-head` / `.lane` without changing `HEAD_W` / `LANE_H` in Mixer.tsx.
3. Hover-only affordances need a `@media (hover:none)` fallback.
4. New drag surfaces need `touch-action:none` (CSS or inline) + setPointerCapture.
5. Fixed-height stages (`.ed-options`, `.media-preview.*`) are intentional anti-layout-shift
   devices — don't make them auto-height. A grid stage whose child uses `height:100%`/
   `max-height:100%` (`.mp-video`, `.vw-preview`, mobile `.gif-preview`) MUST keep
   `grid-template-rows:100%` + `overflow:hidden`: with the default auto row the child's
   intrinsic pixel size wins and the media overflows onto the controls below.
6. Keyframes must end `transform:none` AND transform-animating entrances use fill `backwards` — a finished
   'both'/'forwards' fill keeps a transform that overrides sheet slides and traps fixed descendants
   (invariant 17).
7. `.tool-btn.active:hover` keeps `color: var(--bg)` (invariant 6).
8. The page body must NEVER scroll horizontally (html/body overflow-x clip stays; a decorative
   element wider than the viewport gets clipped by its own container, like `.hero`).
