---
description: Audit connected MCP servers — which ones you actually use, which to disable
---

Audit MCP server dead weight.

1. Run via Bash: `node "${CLAUDE_PLUGIN_ROOT}/scripts/mcp-audit.js" --project-dir "<current working directory>"`
   - If node is not found, tell the user leakhound needs Node.js on PATH and stop.
2. Parse the JSON output.
3. Render, nothing else:
   - Header: servers found, window (30 days), and the report's `note` field verbatim as a one-line caveat.
   - Table sorted as given (least used first): Server | Origin | Calls (30d) | Last used | Verdict.
     - Visual bars: for Calls (30d), render `Math.round(calls30d / max * 20)` `█` characters padded to 20 with `░`, value right-aligned after the bar. Put ALL bar output inside one fenced code block so alignment survives. Mark DISABLE? rows with a trailing `✗`. Example:
       ```
       mcp-fs            ████████████████░░░░  1,234 ✗
       mcp-github        ███████████████░░░░░  987
       ```
   - For every DISABLE? row, list its `disableHint` as the action.
   - Closing: count of DISABLE? candidates. If zero, say the setup is lean.
4. Do not print raw JSON. Verdicts are suggestions — never run a disable command yourself.
