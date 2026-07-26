---
description: Audit installed Claude Code plugins — which earn their context cost, which to disable
---

Audit installed-plugin dead weight.

1. Run via Bash: `node "${CLAUDE_PLUGIN_ROOT}/scripts/plugin-audit.js"`
   - If node is not found, tell the user leakhound needs Node.js on PATH and stop.
2. Parse the JSON. If it has an `error` field: report it in one line and stop.
3. Render, nothing else. The visual block below is MANDATORY — never replace it with a plain table:
   - Summary chip line first: `🟢 N keep · 🔴 N disable candidates · 🟡 N hook-only` (omit zero chips).
   - Main block: fenced code block, language `diff` (colors rows: `+` green, `-` red, space-prefixed neutral). Rows sorted as given (least used first): `-` for DISABLE?, `+` for KEEP, space-prefix (neutral) for HOOK-ONLY. Each row: plugin, bar over invocations30d (`Math.round(v / max(1,max) * 20)` `█` padded to 20 with `░`), invocations, always-on est tokens. Example:
       ```diff
       - mcp-apps        ░░░░░░░░░░░░░░░░░░░░    0  ~428 tok
         leakhound-router░░░░░░░░░░░░░░░░░░░░    0  ~17 tok  (hook-only)
       + playwright      ████████████████████  493  ~12 tok
       ```
   - For every DISABLE? row, list its `hint` as the action and sum their alwaysOnTokensEst as "reclaimable every session (estimate)".
   - HOOK-ONLY rows: mention beneath the block that their usage is genuinely unmeasurable (not idle), with their `hint`. Never fold them into the reclaimable sum.
   - Closing: the `note` field verbatim. If zero DISABLE? rows: say the plugin set is lean.
4. Do not print raw JSON. Never disable anything yourself — recommend only.
