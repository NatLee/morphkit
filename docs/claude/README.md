# AI context system — how it works & how to maintain it

This directory is MorphKit's **context engineering** layer for AI coding sessions.
Docs here are for agents first, humans second: dense, greppable, no marketing prose.

## Design (grounded in current practice)

The layout follows the principles in Anthropic's
[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
(minimal high-signal token set; just-in-time retrieval via lightweight identifiers;
progressive disclosure; sub-agent summarization) and the taxonomy in
[A Survey of Context Engineering for LLMs (arXiv:2507.13334)](https://arxiv.org/abs/2507.13334)
(context retrieval / processing / management as separate concerns):

| Layer | Loaded | Contents | Token rule |
|---|---|---|---|
| `CLAUDE.md` | every session | commands, file map, invariants, map index | keep ≲200 lines; only what can't be derived from code |
| `docs/claude/*.md` | on demand (agent reads when touching that subsystem) | per-subsystem maps: state, functions, DOM/class trees, contracts | read the map INSTEAD of the source; grep names from it |
| `.claude/skills/*` | description always, body on invocation | multi-step recipes (`/add-setting`, `/add-format`) | one recipe per skill, < 100 lines |
| `.claude/settings.json` | mechanical | permission allowlist + Stop hook running the drift checker | no prose here |

Two deliberate non-choices: no `@import` in CLAUDE.md (imports load every session,
defeating on-demand economy) and no line numbers in maps (names are grep-stable, lines are not).

## Maintenance — the part that actually matters

A stale map is worse than no map (the agent trusts it and edits blind). Every content
change has a maintenance trigger:

| When you… | …update |
|---|---|
| add / rename / delete an export, state var, handler, or CSS class that a map mentions | that map's section (a line or two) |
| add a file under `src/` | CLAUDE.md file map row (+ a map section if it's non-trivial) |
| fix a regression caused by non-obvious behavior | CLAUDE.md invariants (that list is the project's crown jewels) |
| add a breakpoint / section to `styles.css` | `styles.md` responsive table |
| change `HEAD_W` / `LANE_H` in Mixer.tsx | the mirrored px values in `styles.css` |
| add a UI string | all three dicts in `i18n.tsx` (zh / en / ja, same position) |

Same-commit rule: map updates ride along with the code change they describe.

## Enforcement (so the table above isn't just vibes)

`node .claude/scripts/check-context.mjs` (or `npm run check:context`) verifies:

1. every path in CLAUDE.md tables exists;
2. every `src/` file has a CLAUDE.md row (new files can't stay unmapped);
3. every map here is indexed in CLAUDE.md;
4. every backticked identifier / `.class` token in a map still exists in its sources
   (manifest inside the script — extend it when adding a map);
5. `HEAD_W`/`LANE_H` ↔ CSS mirror values match;
6. i18n zh/en/ja key sets and `{placeholder}` sets are in parity.

It runs three ways: manually · as a **Stop hook** (warns at the end of any Claude turn
that left drift) · as the **context-check job** in `.github/workflows/deploy.yml`
(visible red on GitHub, but never blocks the Pages deploy).

The checker is intentionally lenient (substring search, fenced code blocks skipped) —
it catches renames/deletions of real identifiers with near-zero false positives. If it
does false-positive, fix the doc wording or extend `SKIP_TOKEN`, don't delete the check.

## References

- Anthropic — [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (2025-09)
- Anthropic — [Claude Code memory & CLAUDE.md docs](https://code.claude.com/docs/en/memory) (imports load at startup; nested CLAUDE.md and `paths:`-scoped `.claude/rules/` load on demand)
- [A Survey of Context Engineering for Large Language Models, arXiv:2507.13334](https://arxiv.org/abs/2507.13334)
- LangChain — [Context Engineering for Agents](https://www.langchain.com/blog/context-engineering-for-agents) (write / select / compress / isolate framing)
