---
description: Audit connected MCP servers — which ones you actually use, which to disable
---

Audit MCP server dead weight.

1. Run via Bash: `node "${CLAUDE_PLUGIN_ROOT}/scripts/mcp-audit.js" --project-dir "<current working directory>"`
   - If node is not found, tell the user leakhound needs Node.js on PATH and stop.
2. Parse the JSON output.
3. Render, nothing else. The visual block below is MANDATORY — never replace it with a plain table:
   - Summary chip line first: `🟢 N keep · 🔴 N disable candidates` (omit a chip when its count is 0).
   - Main block: one fenced code block with language `diff` (colors rows in most terminals: `+` green, `-` red). One row per server, sorted as given (least used first): `-` prefix for DISABLE? rows, `+` prefix for KEEP rows. Each row: server name, bar, calls, last-used. Bar = `Math.round(calls30d / max * 20)` `█` chars padded to 20 with `░`; use `max(1, max)` so all-zero data still renders empty bars. Example:
       ```diff
       - vercel        ░░░░░░░░░░░░░░░░░░░░    0  never
       - github        ░░░░░░░░░░░░░░░░░░░░    0  never
       + figma         █░░░░░░░░░░░░░░░░░░░   11  2026-07-19
       + playwright    ████████████████████  360  2026-07-23
       ```
   - For every DISABLE? row, list its `disableHint` as the action.
   - Closing: count of DISABLE? candidates and the `note` field verbatim. If zero candidates, say the setup is lean.
4. Do not print raw JSON. Verdicts are suggestions — never run a disable command yourself.
