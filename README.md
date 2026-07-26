# leakhound 🐕

![selftests](https://github.com/srikanth-11/leakhound/actions/workflows/selftest.yml/badge.svg)
![license](https://img.shields.io/badge/license-MIT-green)
![zero deps](https://img.shields.io/badge/dependencies-0-blue)

**Your Claude Code limits die too fast. Leakhound finds out why — and hands you the exact command to fix it.**

ccusage tells you *how much* you spent. `/context` shows a snapshot. Nobody tells you *why* a session burned 400k tokens, which of your 8 MCP servers you haven't touched in a month, or that a top-tier model spent the week doing haiku-grade work. Leakhound does — with a concrete fix attached to every finding, computed entirely on your machine.

```
Server        Origin              Calls (30d)              Verdict
playwright    plugin:playwright   ████████████████████ 360  KEEP
figma         plugin:figma        █░░░░░░░░░░░░░░░░░░░  11   KEEP
vercel        plugin:vercel       ░░░░░░░░░░░░░░░░░░░░   0   DISABLE? ✗
github        plugin:github       ░░░░░░░░░░░░░░░░░░░░   0   DISABLE? ✗
expo          plugin:expo         ░░░░░░░░░░░░░░░░░░░░   0   DISABLE? ✗
```

*Real first run on the machine leakhound was built on: 3 dead MCP servers, 6 dead plugins, and ~348,000 top-tier output tokens doing mechanical work a cheaper model handles.*

## Quick start

```
/plugin marketplace add srikanth-11/leakhound
/plugin install leakhound@leakhound
```

Optional — the automatic per-prompt router (registers a hook; see below):

```
/plugin install leakhound-router@leakhound
```

Requires Node.js on PATH. Windows, macOS, Linux — CI runs every selftest on all three.

## Commands

### `/leakhound:waste`

Parses your session transcript (local JSONL) and reports the top token sinks, worst first:

| Finds | Example | Suggested fix |
|---|---|---|
| Re-read files | `app.ts` read 5 times | reference the earlier read; offset/limit |
| Giant reads | one 25k-token result dump | Grep first, read the slice |
| Retry loops | same command failed 4× | stop after 2, change approach |
| Verbose output | 12k-token test log | quiet flags, tail |
| Cache churn | prompt cache rebuilding | avoid mid-session config changes |

`/leakhound:waste all` aggregates the last 30 days for the project.

### `/leakhound:mcp-audit`

Every configured MCP server (user, project, and plugin-bundled) cross-referenced against 30 days of actual usage across all your projects. Zero-call servers get a `DISABLE?` verdict with the exact removal command.

### `/leakhound:plugin-audit`

Same treatment for installed plugins: component inventory (skills, commands, agents, hooks, bundled MCP servers), an always-on context estimate, and 30 days of real invocations. Verdicts: `KEEP`, `DISABLE?` (with reclaimable per-session tokens), or `HOOK-ONLY` (hook-carrying plugins whose usage can't be measured from transcripts — leakhound never guesses).

### `/leakhound:model-audit [cost|balanced|quality]`

Is a top-tier model doing haiku-grade work? Classifies 30 days of assistant messages by tool pattern **and output size** (an edit wrapped in heavy reasoning counts as complex, not mechanical), maps each model to a tier, and flags mismatches weighted by your preference:

- `cost` — aggressive: flags top-tier on mechanical *and* search work
- `balanced` — flags top-tier on mechanical work only
- `quality` — also flags *cheap models on complex work* as a quality risk

Your choice persists and the router uses the same weight. Also reports **delegation compliance** — how often work was actually handed to cheaper subagent models.

Optional real dollars: add prices you maintain to `~/.claude/leakhound.json` and the audit prints `$` alongside tokens:

```json
{ "prices": { "top": 25, "mid": 6, "cheap": 1 } }
```

### `/leakhound:trend`

Are the numbers improving? Every audit run appends a summary to `~/.claude/leakhound-history.jsonl`; trend renders per-metric deltas and sparklines over the last 12 runs:

```
mechanicalMsgs       ███▁▁██▅  latest 460      (−322 vs previous)
reallocatableTokens  ███▁▁██▃  latest 347,796  (−1,104,525 vs previous)
```

### `/leakhound-router:router [on|off|status]`

The automatic lever, opt-in, shipped as a **separate plugin** so audit-only installs pay zero per-prompt cost. When on, a lightweight hook classifies every prompt (mechanical / search / complex) and injects a directive telling Claude to execute cheap work via a haiku subagent — weighted by your saved preference.

Honest limits, stated up front: hooks cannot change the session model (platform rule) — the router moves the *execution* tokens, which is where the burn lives. The main model keeps coordinating.

Tune it in `~/.claude/leakhound.json` (regex strings, JSON double-backslash escaping; `never` always wins):

```json
{
  "routerPatterns": {
    "mechanical": ["\\bregen snapshots?\\b"],
    "search": [],
    "never": ["\\bdeploy\\b"]
  }
}
```

## Configuration reference

All state lives in one file, `~/.claude/leakhound.json` (or `$CLAUDE_CONFIG_DIR/leakhound.json`):

| Key | Values | Default | Used by |
|---|---|---|---|
| `modelWeight` | `cost` \| `balanced` \| `quality` | `balanced` | model-audit flags, router matrix, subagent delegation |
| `router` | `on` \| `off` | `off` | router hook |
| `routerPatterns` | `{mechanical, search, never}` regex arrays | none | router classification |
| `prices` | `{top, mid, cheap}` USD per M output tokens | none | model-audit `$` figures |

## Privacy

Everything runs locally. **No network calls, no telemetry, zero npm dependencies.** Reports contain file paths, tool names, model names, and counts — never your transcript content. Read the scripts; they're five small plain-Node files.

## How it works

Five zero-dependency Node scripts — four parse `~/.claude/projects/**/*.jsonl` (per-message token usage, tool calls, serving model) and your MCP/plugin configs; the fifth is the router hook. Command markdown renders their JSON. Run them yourself:

```
node scripts/waste.js --project-dir /path/to/project
node scripts/mcp-audit.js
node scripts/model-audit.js
node scripts/plugin-audit.js
node scripts/trend.js
```

Every script has a `--selftest` flag; CI runs all six on ubuntu, macos, and windows.

## FAQ

**Why not just switch the model automatically?** Not possible — no Claude Code hook can change the session model (verified against the hook output schema). Leakhound does the honest maximum: audits that tell you what to change, and a router that moves execution work to cheaper subagents automatically.

**Will it tell me to disable something I actually use?** It errs toward KEEP: fuzzy matches over-attribute usage, hook-only plugins get `HOOK-ONLY` instead of `DISABLE?`, and every verdict shows the raw counts so you can judge.

**What does leakhound itself cost?** ~253 always-on tokens for the audit plugin, zero hooks. The router plugin adds one ~240ms hook per prompt — which is exactly why it's separate and opt-in.

## License

MIT — see [LICENSE](LICENSE).
