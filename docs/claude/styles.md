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
3. `hero` — .hero + synthwave floor `.hero::before` (perspective grid, gridFlow anim) +
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
    hidden ≤760 — all driven by lib/useSplitter)
    .ie-vpwrap .zoom-float
    .ie-viewport(max-h 54vh) .ie-inner .ie-canvas2(**touch-action:none**, checkerboard bg) .zoom-ctrl
    .zoom-val · .layers-panel(max-h 54vh) .layer-* .lp-head .lp-props .lp-row .lp-blend .lp-mask-btns
    .lp-layer .lp-layer-head .lp-title .lp-thumb .lp-actions(**hover-revealed; forced visible on touch**)
    .lp-name .lp-badge .lp-obj .layer-bg-row · `canvas size modal`: .canvas-modal .preset-grid .preset
    .size-row .size-field
17. `gif editor v2` — .gif-transport(nowrap scroll; wraps ≤640) .play-btn .gif-pos .gif-delay ·
    .strip(horizontal film strip) .thumb(.active/.dim) · .tb-select .cap-panel .cap-row .cap-text
    .num-sm .cap-dash
18. `studio` — .studio-toggle · .app.studio-mode(full-bleed) · .studio(**desktop: fixed height
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
19. `footer` — .footer
20. `pwa / app shell` — .install-card (fixed corner card, z95; phone: full-width above tab bar)
    .install-icon .install-text .install-btns · .m-tabbar (base display:none — shown ≤640 in the
    mobile layer) · .wand-global lives in section 16 (text tool-btn, width:auto)
21. `shared motion` — `rise` keyframes (**end frames MUST be `transform:none`** — invariant 17)
22. `responsive & motion` + **mobile optimization layer** (see below)
23. `micro-interactions` — tap-highlight, :active press, focus-visible, .drop-hot, modalPop,
    `prefers-reduced-motion` (last block in file)

## Responsive architecture (all breakpoints, why)

| Query | What |
|---|---|
| `≤900px` | .ie-layout side panel 262→220px |
| `≤760px` | .st-body + .vw-top collapse to 1 column; .split-gutter hidden; **.studio → height:auto (page scrolls like a normal mobile page)**; .st-assets max-height 30vh; inline .ie-viewport 42vh + inline .layers-panel 32vh |
| `≤720px` (image editor) | **.layers-panel → fixed bottom sheet** (translateY 105% ↔ .open, z130, 62dvh) + .lp-scrim (z129) + .lp-fab shown (toggle lives in ImageEditor.tsx panelOpen state); inline .ie-viewport bumps to 56vh |
| `≤640px` (image editor) | `.editor-overlay > .editor:has(.ie-layout)` → **fixed 100dvh flex column, children reordered** (head 0 → ie-layout 1 flex-fill w/ align-items:stretch → options 2 → toolbar 3 nowrap-scroll → foot 4); .ie-viewport flex + .ie-inner margin:auto centers the canvas |
| `≤720px` | .ie-layout → 1 column (layers panel stacks below canvas) |
| `≤640px` (phone) | .app gutter 16px; .topbar wraps; hero compact; dropzone compact; .bb-actions full-width grow; file-card controls grow + .fc-details 1col; **modal editors become full-width sheets** (.editor-overlay padding 0, .editor 100% wide, radius 0, safe-area padding, 100dvh cap); .media-preview.mp-video 34vh; .ie-viewport/.ie-canvas 44vh + .layers-panel 240px; .ed-toolbar + .gif-transport wrap into rows (.ed-options stays a nowrap scroller on purpose); drawer + studio compact; **text/number inputs + selects → 16px font (iOS focus-zoom guard)**; .fp-preview 180px; .vw-preview 26vh |
| `≤640px` (app tabs) | `.m-tabbar` → fixed bottom grid ×3 (z95, safe-area padding); `.studio-toggle` hidden (tab bar owns mode switching); `.app`/`.app.studio-mode` get padding-bottom clearance; `.st-note` + `.install-card` raised above the bar |
| `@media (display-mode: standalone)` | installed PWA: `.footer` hidden; `.topbar` padding-top honors `env(safe-area-inset-top)` (22px desktop / 14px ≤640) |
| `≤400px` | gutter 12px, hero-title 34px, lang buttons tighter |
| `@supports (height:100dvh)` | .studio/.st-launcher/.editor/.type-modal switch to dvh (mobile URL-bar resize) |
| `@media (hover:none)` | .lp-actions always visible; .clip-edge tinted; .kbd-hints/.dz-kbd hidden |
| `@media (pointer:coarse)` | .tool-btn 40px, dual-handle 22px, swatches 18px, clip-edge 14px, layer/track buttons enlarged, .btn min-height 40px, thumbs 56px, overscroll-behavior:contain on scrollers |

Also: `body:has(.editor-overlay), body:has(.drawer-overlay) { overflow:hidden }` (scroll lock) ·
`.st-note` bottom uses `env(safe-area-inset-bottom)` · viewport meta has `viewport-fit=cover` (index.html).

## Rules when touching CSS here

1. New component styles go inside the matching banner section; new breakpoint rules go in the
   mobile layer (section 21) so they win the cascade.
2. Never shrink `.trk-head` / `.lane` without changing `HEAD_W` / `LANE_H` in Mixer.tsx.
3. Hover-only affordances need a `@media (hover:none)` fallback.
4. New drag surfaces need `touch-action:none` (CSS or inline) + setPointerCapture.
5. Fixed-height stages (`.ed-options`, `.media-preview.*`) are intentional anti-layout-shift
   devices — don't make them auto-height.
6. Keyframes must end `transform:none`; modals must portal to body (invariant 17).
7. `.tool-btn.active:hover` keeps `color: var(--bg)` (invariant 6).
