---
description: Toggle leakhound's per-prompt model router (on|off|status)
---

Manage the leakhound router.

1. Argument handling: `on` or `off` → run `node "${CLAUDE_PLUGIN_ROOT}/scripts/router-hook.js" --set <arg>`; no argument or `status` → run with `--status`.
2. Parse the JSON `{router, modelWeight}` and report both in one line, e.g. "Router ON, weight cost — mechanical and search prompts get haiku-delegation directives."
3. When turning on, add one honest line: the router cannot change the session model (platform limit) — it injects per-prompt directives so execution work is delegated to cheaper subagent models; the injection matrix follows the saved weight (cost: mechanical+search, balanced: mechanical, quality: never — set weight via /leakhound:model-audit). Tune classification in `~/.claude/leakhound.json`: `"routerPatterns": {"mechanical": ["\\bregen snapshots?\\b"], "search": [], "never": ["\\bdeploy\\b"]}` — regex strings (JSON double-backslash escaping), `never` always wins.
4. Do not print raw JSON.
