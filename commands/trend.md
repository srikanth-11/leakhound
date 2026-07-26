---
description: Show how leakhound audit results change over time — deltas and sparklines
---

Show audit trends.

1. Run via Bash: `node "${CLAUDE_PLUGIN_ROOT}/scripts/trend.js"`
   - If node is not found, tell the user leakhound needs Node.js on PATH and stop.
2. Parse the JSON. If it has an `error` field: report it in one line (suggest running the audits) and stop.
3. Render per tool. The visual block is MANDATORY: one fenced code block per tool with language `diff` (colors rows: `+` green, `-` red). Tool name + run count as a heading line above the block, then one row per metric: `<metric>  <sparkline>  latest <value>  (<+/- delta> vs previous)`.
   - Row prefix is DIRECTION-AWARE. Lower is better for: `mechanicalMsgs`, `reallocatableTokens`, `reclaimableTokens`, `disable`. For those, a negative delta gets `+` (green, improving) and a positive delta gets `-` (red, worsening). All other metrics (`servers`, `plugins`, `totalCalls`, `topOutputTokens`) and zero deltas stay neutral (space prefix). Omit the delta clause when deltas is null.
   - Example:
       ```diff
       + mechanicalMsgs       ███▁▁██▅  latest 460      (-322 vs previous)
       + reallocatableTokens  ███▁▁██▃  latest 347,796  (-1,104,525 vs previous)
         topOutputTokens      ███▁▁███  latest 3,109,773 (+31,626 vs previous)
       ```
4. Close with a one-line verdict chip: `🟢 trending leaner` if any lower-is-better metric improved and none worsened, `🔴 trending heavier` if any worsened, `⚪ flat` otherwise — then the `note` verbatim. No raw JSON.
