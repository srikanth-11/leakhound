# Changelog

All notable changes to this project are documented here.

## [0.8.3] — 2026-07-26

### Added

- /waste now appends a summary line (findings count, waste tokens, compactions) to `~/.claude/leakhound-history.jsonl`, so /trend charts waste-per-session over time — including whether compactions are becoming more or less frequent. Trend rendering treats all three as lower-is-better

## [0.8.2] — 2026-07-26

### Fixed

- Statusline ignores subagent (sidechain) usage lines: the meter tracks the main conversation's context only, so it can no longer dip to a subagent's small context mid-run. A flat number while subagents work is correct: their burn never inflates your main context

## [0.8.1] — 2026-07-26

Main plugin and leakhound-guard both move to 0.8.1; leakhound-router stays 0.3.3. The changelog tracks the main plugin, with companion versions named inline.

### Fixed

- mcp-audit invocation counting is now structural (parsed tool_use blocks), closing the raw-string matching gap plugin-audit had already fixed — poisoned tool output can no longer inflate MCP usage counts
- Guard re-read denials trip once per file instead of twice: subagents share the parent session id and could be denied a first read of a file only the parent had seen (leakhound-guard 0.8.1)
- README example bars recomputed to the documented formula; hero chips match the rows shown; trend example uses the real per-tool block shape; state-file documentation now covers the history file and guard memory
- Release/skill/agent docs cover all three plugins and all eight selftests; argument-hint added to argument-taking commands; marketplace entries gained schema and homepage fields

## [0.8.0] — 2026-07-26

### Added

- leakhound-guard, a third opt-in plugin: waste firewall on the Read tool. Denies whole-file reads of lockfiles/build artifacts (>~20k est tokens) with a Grep redirect, and full re-reads of files unchanged since already read this session (mtime-checked). Offset/limit reads always pass; a third identical attempt always passes (circuit breaker — no hard loops). `/leakhound-guard:guard` for status and per-rule toggles

### Changed

- Router status matrix spells out non-routed classes in words ("complex stays on session model") instead of a bare dash glyph (leakhound-router 0.3.3)

## [0.7.3] — 2026-07-26

### Fixed

- OS-neutral fix advice: verbose-output suggestions now name both tail (macOS/Linux) and Select-Object -Last (PowerShell) instead of assuming unix tools

## [0.7.2] — 2026-07-26

### Fixed

- /leakhound:live snippet guidance made OS-neutral: forward-slash config-dir paths on macOS, Linux, and Windows alike

## [0.7.1] — 2026-07-26

### Fixed

- /leakhound:live setup: statusline path is now always written with forward slashes and applied via file-editing tools with a post-write verification step. Backslash paths built through shell one-liners were silently mangled on Windows, leaving a dead statusline (found by hitting it)

## [0.7.0] — 2026-07-26

### Added

- Live statusline (`/leakhound:live`): real-time context meter in the terminal — context size with pressure colors and "compaction near" warning, direction arrow, last-turn output tokens. Tail-reads the live transcript only; thresholds tunable via leakhound.json `live` key

## [0.6.0] — 2026-07-26

### Added

- Structured fixes in /waste: every finding carries now / say / adopt — an immediate action, the exact prompt to paste at Claude (with the real file or command baked in), and the durable habit
- Quiet-flag lookup for verbose-output (npm/jest, vitest, pytest, cargo, playwright, go test, gradle)
- Lockfile/build-artifact recognition in giant-read (Grep-only rule)
- Prioritized action plan (top 3 by tokens) in the /waste render
- CLAUDE.md block generator: paste-ready project rules built from your findings; leakhound never edits your files

## [0.5.0] — 2026-07-26

### Added

- Compaction detection in /waste: context drops >30% and >20k tokens are counted, and post-compaction re-reads of pre-compaction files become a `compaction-waste` finding
- Context-pressure signal: warns when recent input averages >50k tokens (compaction incoming)
- Personal baselines: with 5+ sessions of history, /waste all compares the latest session to your 30-day median, and /model-audit reports mechanical share vs your typical session

## [0.4.3] — 2026-07-26

### Security

- Structural invocation matching in plugin-audit: needles are now checked against parsed transcript entries (tool_use block names/inputs, string user-message content) instead of raw substrings, so poisoned tool output (e.g. web content quoting `<command-name>/x:y` or `mcp__plugin_x_`) can no longer inflate a plugin's usage count
- Symlink-safe config and history writes: router-hook's `leakhound.json` write now goes through a write-temp-then-rename helper that refuses to follow a symlinked target; the model-audit, mcp-audit, and plugin-audit history appends now skip silently if `leakhound-history.jsonl` is a symlink
- CI least privilege: top-level `permissions: contents: read` on the selftest workflow, with `actions/checkout` and `actions/setup-node` pinned to commit SHAs (leakhound-router 0.3.2)
- Sanitized `/waste` finding descriptions (control characters stripped, length-capped) so a hostile file path or tool name can't inject newlines into rendered output
- Removed the literal `$ARGUMENTS` placeholder from the `/waste` command template

## [0.4.2] — 2026-07-26

### Changed

- Color-visual rendering in every command: diff-fenced blocks (green KEEP / red DISABLE? / neutral), verdict emoji chips, mandatory bars, direction-aware trend rows, router status chip + injection-matrix line (leakhound-router 0.3.1)

## [0.4.1] — 2026-07-26

### Fixed

- HOOK-ONLY verdict for hook-carrying plugins whose usage cannot be measured from transcripts (was: false DISABLE?)

## [0.4.0] — 2026-07-26

### Added

- Output-size classification signal for audit results
- Selftest hardening in model-audit (duplicate-delegation fixture, input-token assert) and mcp-audit (wrapped-format fixture)
- CI matrix (ubuntu, macos, windows) via GitHub Actions
- Changelog and versioning

### Changed

- Stale-audit nudge: prompts refresh when history is missing or older than 30 days

## [0.3.0] — 2026-07-25

### Added

- Leakhound-router split into separate companion plugin
- Input token counts and optional pricing in model-audit
- Audit history tracking and `/trend` command with sparklines
- Bar-chart rendering rules for audit commands
- User-tunable router patterns with never-override safeguards

### Changed

- Model-audit delegation compliance reporting

## [0.2.0] — 2026-07-25

(model-audit landed just before the 0.2.0 version bump; grouped here by theme)

### Added

- `/model-audit` command with weighted model-fit analysis
- `/plugin-audit` command and marketplace integration
- Per-prompt router hook with weight-aware delegation

## [0.1.0] — 2026-07-25

### Added

- Initial release: `/waste` token-burn analyzer
- `/mcp-audit` command for server usage cross-reference
