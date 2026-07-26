---
description: Audit which model does which work — weighted by your cost vs quality preference
---

Audit model fit for the current project.

1. If the user passed an argument (cost, balanced, or quality), pass it through as `--weight <value>`; otherwise omit the flag (the script uses the saved preference).
2. Run via Bash: `node "${CLAUDE_PLUGIN_ROOT}/scripts/model-audit.js" --project-dir "<current working directory>" [--weight <value>]`
   - If node is not found, tell the user leakhound needs Node.js on PATH and stop.
3. Parse the JSON. If it has an `error` field: report it in one line and stop.
4. Render, nothing else. The visual blocks below are MANDATORY — never replace them with plain tables:
   - Header: active weight, window (30 days), files analyzed count.
   - Per-model block: fenced code block, language `diff`, neutral rows (no +/- prefix, space-prefixed): model, tier, bar over outputTokens (`Math.round(v / max * 20)` `█` padded to 20 with `░`), output tokens, input tokens, and `$` when `estCostUSD` is present. Example:
       ```diff
         claude-opus-4-8  top  ████████████████████  1,702,478 out  186,076 in  $42.56
         claude-fable-5   top  █████████████████░░░  1,407,295 out  251,945 in  $35.18
       ```
   - Bucket distribution: one line, 4 proportional segments out of 20 blocks with distinct fills, labeled. Example: `mechanical ████ search ███ prose ██ complex ███████████`.
   - If `baseline` is non-null: one line — `mechanical share: <overallSharePct>% overall vs <medianMechanicalSharePct>% typical session (<sessions> sessions)`.
   - Delegation chip (if `delegation.events` > 0): `🟢 Delegation: N events, M% to cheaper models` when compliancePct >= 70, else `🔴` with the same text.
   - Flags block (when flags exist): fenced `diff` block, every flag row `-` prefixed (renders red): tier+bucket, bar over estOutputTokens, tokens, `$` when present. One suggestion line per flag beneath the block. If no flags: render `+ model split looks right for this weight` in a `diff` fence.
   - Closing: reallocatable output tokens (labeled estimate), `$` when `reallocatableUSD` present, and the `note` field verbatim.
   - If skippedLines > 0, note the count.
5. Do not print raw JSON. Never run /model yourself — recommend only.
