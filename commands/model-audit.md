---
description: Audit which model does which work — weighted by your cost vs quality preference
---

Audit model fit for the current project.

1. If the user passed an argument (cost, balanced, or quality), pass it through as `--weight <value>`; otherwise omit the flag (the script uses the saved preference).
2. Run via Bash: `node "${CLAUDE_PLUGIN_ROOT}/scripts/model-audit.js" --project-dir "<current working directory>" [--weight <value>]`
   - If node is not found, tell the user leakhound needs Node.js on PATH and stop.
3. Parse the JSON. If it has an `error` field: report it in one line and stop.
4. Render, nothing else:
   - Header: active weight, window (30 days), files analyzed count.
   - Per-model table: Model | Tier | Messages | Input tokens | Output tokens (sorted as given).
     - Visual bars: for Output tokens, render `Math.round(outputTokens / max * 20)` `█` characters padded to 20 with `░`, value right-aligned after the bar. Put ALL bar output inside one fenced code block so alignment survives. When `estCostUSD` field is present, append cost in $ format. Example:
       ```
       claude-opus-4-8   ████████████████░░░░  1,702,478  $12.34
       claude-fable-5    ███████████████░░░░░  1,300,948  $8.91
       ```
   - Delegation line (if `delegation.events` > 0): "Delegation: N events, M% to cheaper models".
   - Bucket counts line: mechanical / search / prose / complex (proportional 4-segment bar out of 20 blocks).
   - Flags table: Model | Bucket | Messages | Est. tokens | Suggestion. When `estCostUSD` field is present, append cost in $ format. If empty: say the model split looks right for this weight.
   - Closing: reallocatable output tokens (labeled estimate). When `reallocatableUSD` field is present, append cost in $ format. Include the report's `note` field verbatim.
   - If skippedLines > 0, note the count.
5. Do not print raw JSON. Never run /model yourself — recommend only.
