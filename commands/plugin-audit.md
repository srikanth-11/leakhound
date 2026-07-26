---
description: Audit installed Claude Code plugins — which earn their context cost, which to disable
---

Audit installed-plugin dead weight.

1. Run via Bash: `node "${CLAUDE_PLUGIN_ROOT}/scripts/plugin-audit.js"`
   - If node is not found, tell the user leakhound needs Node.js on PATH and stop.
2. Parse the JSON. If it has an `error` field: report it in one line and stop.
3. Render, nothing else:
   - Header: plugin count, window (30 days), the `note` field verbatim as the caveat.
   - Table sorted as given (least used first): Plugin | Components (Nsk/Ncmd/Nag/Nmcp) | Always-on est. tokens | Invocations (30d) | Verdict.
     - Visual bars: for Invocations (30d), render `Math.round(invocations30d / max * 20)` `█` characters padded to 20 with `░`, value right-aligned after the bar. Put ALL bar output inside one fenced code block so alignment survives. Mark DISABLE? rows with a trailing `✗`. Example:
       ```
       figma             ████████████████░░░░  487 ✗
       vercel            ███████████████░░░░░  234
       ```
   - For every DISABLE? row, list its `hint` as the action and sum their alwaysOnTokensEst as "reclaimable every session (estimate)".
   - After the DISABLE? section, list HOOK-ONLY rows (no `✗` marker — usage is genuinely unmeasurable, not idle) with their `hint`. Do not fold them into the reclaimable-tokens sum.
   - If zero DISABLE? rows: say the plugin set is lean.
4. Do not print raw JSON. Never disable anything yourself — recommend only.
