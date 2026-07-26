---
description: Find where this project's Claude Code tokens went — top waste sources with fixes
---

Analyze token waste for the current project.

1. Run via Bash (quote the path; works on Windows and Unix):
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/waste.js" --project-dir "<current working directory>" $ARGUMENTS`
   - If the user passed `all`, pass `--all`.
   - If node is not found, tell the user: leakhound needs Node.js on PATH (https://nodejs.org) and stop.
2. Parse the JSON output.
   - If it has an `error` field: report it in one line and stop.
3. Render a report, nothing else:
   - One header line: which transcript files were analyzed, and note if the newest is the live session (still growing).
   - Totals line: `output ~N tokens, cache writes ~N, cache reads ~N` (all estimates).
   - A table of findings, sorted as given (already worst-first), columns: Category | What happened | Est. tokens | Fix.
     - Visual bars: for estTokens, render `Math.round(estTokens / max * 20)` `█` characters padded to 20 with `░`, value right-aligned after the bar. Put ALL bar output inside one fenced code block so alignment survives. Example:
       ```
       cache-reread       ████████████████░░░░  1,702,478
       shell-output       ███████████████░░░░░  1,300,948
       ```
   - If findings is empty: say the session looks clean and list the thresholds (single result > 20k est tokens, 3+ re-reads of one file, 3+ consecutive failures, shell output > 10k est tokens).
   - Closing line: estimated recoverable tokens = sum of finding estTokens, labeled estimate.
   - If skippedLines > 0, note how many malformed lines were skipped.
4. Do not print raw JSON, do not dump transcript content, do not editorialize beyond the fix column.
