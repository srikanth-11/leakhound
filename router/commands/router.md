---
description: Toggle leakhound's per-prompt model router (on|off|status)
---

Manage the leakhound router.

1. Argument handling: `on` or `off` → run `node "${CLAUDE_PLUGIN_ROOT}/scripts/router-hook.js" --set <arg>`; no argument or `status` → run with `--status`.
2. Parse the JSON `{router, modelWeight}` and report with a status chip: `🟢 Router ON` or `⚪ Router OFF`, followed by the weight and what it means, e.g. "🟢 Router ON · weight cost, so mechanical and search prompts get haiku-delegation directives." Then a one-line matrix visual inside a fenced code block showing which classes inject under the active weight; ✅ means that class gets the cheap-subagent directive, and classes left on the session model say so in words. E.g. for cost: `mechanical ✅  search ✅  complex stays on session model`.
3. When turning on, add one honest line: the router cannot change the session model (platform limit) — it injects per-prompt directives so execution work is delegated to cheaper subagent models; the injection matrix follows the saved weight (cost: mechanical+search, balanced: mechanical, quality: never — set weight via /leakhound:model-audit). Tune classification in `~/.claude/leakhound.json`: `"routerPatterns": {"mechanical": ["\\bregen snapshots?\\b"], "search": [], "never": ["\\bdeploy\\b"]}` — regex strings (JSON double-backslash escaping), `never` always wins.
4. Do not print raw JSON.
