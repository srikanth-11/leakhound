---
description: Show how leakhound audit results change over time — deltas and sparklines
---

Show audit trends.

1. Run via Bash: `node "${CLAUDE_PLUGIN_ROOT}/scripts/trend.js"`
   - If node is not found, tell the user leakhound needs Node.js on PATH and stop.
2. Parse the JSON. If it has an `error` field: report it in one line (suggest running the audits) and stop.
3. Render per tool, inside a fenced code block for alignment: tool name, run count, then one line per metric: `<metric>  <sparkline>  latest <value> (<+/- delta> vs previous)`. Omit the delta clause when deltas is null.
4. Close with the `note` verbatim. No raw JSON.
