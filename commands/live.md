---
description: Set up the live leakhound statusline — real-time context meter and burn in your terminal
---

Set up (or remove) the leakhound live statusline.

1. `off` argument → removal: tell the user to delete the `statusLine` entry from `~/.claude/settings.json` (show which lines), and that `~/.claude/leakhound-statusline.js` can be deleted too. Do not edit settings.json unless they explicitly ask you to.
2. Otherwise, setup:
   a. Copy `${CLAUDE_PLUGIN_ROOT}/scripts/statusline.js` to `<CLAUDE_CONFIG_DIR or ~/.claude>/leakhound-statusline.js` (a stable path — the plugin cache path changes on every version update and would break the statusline). Overwriting a previous copy is fine; it is leakhound's own file. This copy is the ONLY file leakhound ever writes outside its own config, it happens only through this command, and you must say so in one line.
   b. Show the exact settings.json snippet with the real resolved path, ALWAYS with forward slashes — they work on Windows too and survive every escaping layer; backslashes get silently eaten when this entry is built through a shell, leaving a dead path:
      ```json
      "statusLine": { "type": "command", "command": "node \"C:/Users/<name>/.claude/leakhound-statusline.js\"" }
      ```
   c. Ask whether they want you to add it to `~/.claude/settings.json` for them or paste it themselves. Only edit the file with their explicit yes, merging carefully (never clobber other keys). Apply the edit with a file-editing tool (Read then Edit/Write), NEVER via a shell one-liner (echo, node -e) — multi-layer quoting is exactly how paths get mangled. After writing, verify: re-read the file, confirm the command string still contains the full path with its slashes, and JSON-parse the file.
3. Explain the badge in two lines: `🐕 ctx 690k↑ · +2.1k out` = current context size (green/yellow/red by pressure, red warns "compaction near"), direction arrow, last-turn output tokens. Thresholds are heuristics, tunable in `~/.claude/leakhound.json`: `"live": {"yellow": 500000, "red": 800000}`.
4. Note: after each leakhound update that changes the statusline, re-run `/leakhound:live` to refresh the copied script.
5. No raw JSON dumps.
