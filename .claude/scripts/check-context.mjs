#!/usr/bin/env node
/**
 * Context-map drift checker — keeps CLAUDE.md + docs/claude/* honest.
 * Methodology & maintenance rules: docs/claude/README.md
 *
 * Usage:
 *   node .claude/scripts/check-context.mjs          # CLI: exit 1 + report on drift
 *   node .claude/scripts/check-context.mjs --hook   # Stop-hook: always exit 0,
 *                                                   # emit {systemMessage} JSON on drift
 * Checks:
 *   1. Every path in CLAUDE.md tables exists (src files + docs/claude maps)
 *   2. Every src/ source file has a CLAUDE.md file-map row (new files must be mapped)
 *   3. Every docs/claude/*.md except README is referenced from CLAUDE.md
 *   4. Identifier / .class tokens in each map still exist in its mapped sources
 *   5. Mixer HEAD_W / LANE_H mirror .trk-head width / .lane height in styles.css
 *   6. i18n: zh / en / ja key sets match, and {placeholder} sets match per key
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = process.argv.includes('--hook');
const issues = [];
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

try {
  // ---------- 1. CLAUDE.md table paths exist ----------
  const claudeMd = read('CLAUDE.md');
  for (const m of claudeMd.matchAll(/^\| `([^`]+)` \|/gm)) {
    const p = m[1];
    const full = p.startsWith('docs/') ? join(ROOT, p) : join(ROOT, 'src', p);
    if (!existsSync(full)) issues.push(`CLAUDE.md references missing file: ${p.startsWith('docs/') ? p : 'src/' + p}`);
  }

  // ---------- 2. every src file has a CLAUDE.md row ----------
  const SKIP_SRC = new Set(['main.tsx', 'vite-env.d.ts']);
  for (const dir of ['src', 'src/components', 'src/lib']) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (!/\.(tsx?|css)$/.test(f) || SKIP_SRC.has(f)) continue;
      if (!existsSync(join(ROOT, dir, f)) || f === 'components' || f === 'lib') continue;
      const rel = dir === 'src' ? f : `${dir.slice(4)}/${f}`;
      if (!claudeMd.includes('`' + rel + '`'))
        issues.push(`src/${rel} has no row in CLAUDE.md file map (new file? add a one-line role)`);
    }
  }

  // ---------- 3. every map is referenced from CLAUDE.md ----------
  const mapsDir = join(ROOT, 'docs', 'claude');
  const mapFiles = existsSync(mapsDir) ? readdirSync(mapsDir).filter((f) => f.endsWith('.md')) : [];
  for (const f of mapFiles) {
    if (f === 'README.md') continue;
    if (!claudeMd.includes('`docs/claude/' + f + '`'))
      issues.push(`docs/claude/${f} is not listed in CLAUDE.md's map index`);
  }

  // ---------- 4. map tokens still exist in their sources ----------
  const MANIFEST = {
    'app-shell.md': ['src/App.tsx', 'src/components/Hero.tsx', 'src/components/DropZone.tsx', 'src/components/FileCard.tsx', 'src/components/SettingsPanel.tsx', 'src/components/FormatMatrix.tsx', 'src/components/DualRange.tsx', 'src/components/Overlay.tsx', 'src/components/FramePicker.tsx', 'src/components/InfoTip.tsx', 'src/components/InstallPrompt.tsx', 'src/main.tsx', 'src/styles.css'],
    'editors.md': ['src/components/ImageEditor.tsx', 'src/components/GifEditor.tsx', 'src/components/PdfEditor.tsx', 'src/components/ColorPicker.tsx', 'src/styles.css'],
    'studio.md': ['src/components/Studio.tsx', 'src/components/Mixer.tsx', 'src/components/VideoWorkspace.tsx', 'src/components/MediaEditor.tsx', 'src/lib/studioTypes.ts', 'src/lib/audioEngine.ts', 'src/styles.css'],
    'libs.md': ['src/lib/ffmpegClient.ts', 'src/lib/animImage.ts', 'src/lib/pdf.ts', 'src/lib/imageConvert.ts', 'src/lib/metadata.ts', 'src/lib/formats.ts', 'src/lib/settings.ts', 'src/lib/idb.ts', 'src/lib/wav.ts', 'src/lib/audioEngine.ts', 'src/lib/studioTypes.ts', 'src/lib/useSplitter.ts', 'src/types.ts', 'src/i18n.tsx'],
    'styles.md': ['src/styles.css', 'src/components/Mixer.tsx', 'index.html'],
  };
  const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]{2,}$/;
  const CLASS = /^\.[a-z][a-z0-9-]+$/;
  const SKIP_TOKEN = new Set(['the', 'and', 'not', 'via', 'see', 'left', 'src', 'inline', 'null', 'true', 'false']);
  const css = read('src/styles.css');
  for (const [map, sources] of Object.entries(MANIFEST)) {
    const mapPath = join(mapsDir, map);
    if (!existsSync(mapPath)) { issues.push(`manifest expects docs/claude/${map} but it does not exist`); continue; }
    // strip fenced code blocks; scan inline `tokens` only
    const body = read('docs/claude/' + map).replace(/```[\s\S]*?```/g, '');
    const corpus = sources.filter((s) => existsSync(join(ROOT, s))).map(read).join('\n');
    const missing = new Set();
    for (const t of body.matchAll(/`([^`\n]+)`/g)) {
      const tok = t[1];
      if (IDENT.test(tok) && !SKIP_TOKEN.has(tok)) {
        if (!corpus.includes(tok)) missing.add(tok);
      } else if (CLASS.test(tok)) {
        if (!css.includes(tok)) missing.add(tok);
      }
    }
    if (missing.size)
      issues.push(`docs/claude/${map} mentions names no longer in source: ${[...missing].slice(0, 8).join(', ')}${missing.size > 8 ? ` (+${missing.size - 8} more)` : ''}`);
  }

  // ---------- 5. Mixer constants ↔ CSS sync ----------
  const mixer = read('src/components/Mixer.tsx');
  const headW = mixer.match(/HEAD_W\s*=\s*(\d+)/)?.[1];
  const laneH = mixer.match(/LANE_H\s*=\s*(\d+)/)?.[1];
  const cssHead = css.match(/\.trk-head\s*\{[^}]*?width:\s*(\d+)px/s)?.[1];
  const cssLane = css.match(/\.lane\s*\{[^}]*?height:\s*(\d+)px/s)?.[1];
  if (headW && cssHead && headW !== cssHead)
    issues.push(`Mixer HEAD_W (${headW}) != styles.css .trk-head width (${cssHead}px) — playhead/fit() will desync`);
  if (laneH && cssLane && laneH !== cssLane)
    issues.push(`Mixer LANE_H (${laneH}) != styles.css .lane height (${cssLane}px) — vertical clip drag will desync`);
  if (!headW || !cssHead || !laneH || !cssLane)
    issues.push('could not locate HEAD_W/LANE_H or .trk-head/.lane rules — update check-context.mjs check 5');

  // ---------- 6. i18n parity (zh / en / ja) ----------
  const i18n = read('src/i18n.tsx');
  const dicts = {};
  for (const lang of ['zh', 'en', 'ja']) {
    const block = i18n.match(new RegExp(`^const ${lang}: Dict = \\{([\\s\\S]*?)^\\};`, 'm'))?.[1];
    if (!block) { issues.push(`i18n: could not parse dict "${lang}" — update check-context.mjs check 6`); continue; }
    const entries = new Map();
    for (const line of block.split('\n')) {
      const km = line.match(/^\s{2}([A-Za-z0-9_]+):/);
      if (!km) continue;
      const vars = new Set((line.match(/\{[a-zA-Z]+\}/g) ?? []));
      entries.set(km[1], vars);
    }
    dicts[lang] = entries;
  }
  if (dicts.zh && dicts.en && dicts.ja) {
    const langs = Object.keys(dicts);
    const all = new Set(langs.flatMap((l) => [...dicts[l].keys()]));
    for (const key of all) {
      const missingIn = langs.filter((l) => !dicts[l].has(key));
      if (missingIn.length) { issues.push(`i18n key "${key}" missing in: ${missingIn.join(', ')}`); continue; }
      const ref = [...dicts.en.get(key)].sort().join(',');
      for (const l of ['zh', 'ja']) {
        const got = [...dicts[l].get(key)].sort().join(',');
        if (got !== ref) issues.push(`i18n key "${key}": {placeholder} mismatch — en has [${ref}] but ${l} has [${got}]`);
      }
    }
  }
} catch (err) {
  if (HOOK) process.exit(0); // never nag the user because the checker itself broke
  console.error('✗ check-context.mjs crashed:', err.message);
  process.exit(1);
}

if (issues.length) {
  if (HOOK) {
    const head = issues.slice(0, 5).join(' | ');
    console.log(JSON.stringify({
      systemMessage: `⚠ context maps drift (${issues.length}): ${head}${issues.length > 5 ? ' …' : ''} — run \`npm run check:context\` and update CLAUDE.md / docs/claude/`,
    }));
    process.exit(0);
  }
  console.error(`✗ context check: ${issues.length} issue${issues.length > 1 ? 's' : ''}`);
  for (const i of issues) console.error('  - ' + i);
  process.exit(1);
}
if (!HOOK) console.log('✓ context in sync — CLAUDE.md map, docs/claude tokens, HEAD_W/LANE_H, i18n zh/en/ja parity');
