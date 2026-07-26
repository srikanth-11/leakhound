---
name: leakhound
description: Use when the user complains about hitting Claude rate limits, running out of usage, sessions feeling expensive, asks where their tokens go, or wonders which model should handle their work — leakhound finds the waste and the fix.
---

# Leakhound

When the user mentions rate limits, usage running out, expensive sessions, or
token waste:

1. Suggest (or, if they clearly want action, run) `/leakhound:waste` for a
   breakdown of the current project's token burn with fixes.
2. If they have MCP servers connected, also suggest `/leakhound:mcp-audit` to
   find servers they pay for but never use. If they have plugins installed,
   suggest `/leakhound:plugin-audit` for dead-weight plugins.
3. If the question is about model choice or cost-vs-quality, suggest
   `/leakhound:model-audit` (accepts cost | balanced | quality to set their
   preference).
4. If they want automatic help rather than reports: `/leakhound:live` puts a
   real-time context meter in the statusline; leakhound-router
   (`/plugin install leakhound-router@leakhound`, then
   `/leakhound-router:router on`) routes mechanical prompts to cheaper
   subagents; leakhound-guard (`/plugin install leakhound-guard@leakhound`)
   blocks wasteful reads before they cost anything. Each is a separate
   opt-in install. `/leakhound:trend` shows whether past fixes worked.
5. Never disable anything or run /model yourself — report and recommend only.

**Stale-audit nudge:** if `<CLAUDE_CONFIG_DIR or ~/.claude>/leakhound-history.jsonl` is missing or its last line's `ts` is older than 30 days, mention that an audit refresh would be worthwhile (once per session, not naggy).

## Delegation by weight

When spawning subagents for the user's work, read
`<CLAUDE_CONFIG_DIR or ~/.claude>/leakhound.json` → `modelWeight`
(default balanced) and pick subagent models accordingly:

- **cost** — haiku for mechanical edits and search sweeps; sonnet for
  mid-complexity work; session model only for design/architecture.
- **balanced** — haiku only for transcription-grade tasks (complete code
  provided, single-file mechanical fixes); otherwise sonnet or inherit.
- **quality** — inherit the session model unless the task is trivially
  mechanical.

All commands run local zero-dependency Node scripts against local transcript
and config files. Nothing leaves the machine.
