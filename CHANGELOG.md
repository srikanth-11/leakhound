# Changelog

All notable changes to this project are documented here.

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
