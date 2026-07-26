# leakhound 🐕

![selftests](https://github.com/srikanth-11/leakhound/actions/workflows/selftest.yml/badge.svg)
![license](https://img.shields.io/badge/license-MIT-green)
![zero deps](https://img.shields.io/badge/dependencies-0-blue)

**Your Claude Code limits die too fast. Leakhound finds out why and hands you the fix.**

I built this because my own Pro plan kept dying by early afternoon and nothing could tell me where the tokens went. ccusage shows how much you spent. `/context` shows a snapshot. Neither tells you why a session burned 400k tokens, which of your 8 MCP servers you haven't touched in a month, or that an expensive model spent the week doing work a cheap one handles fine. Leakhound tells you, with the exact command to fix each finding. Everything runs on your machine.

```
Server        Origin              Calls (30d)              Verdict
playwright    plugin:playwright   ████████████████████ 360  KEEP
figma         plugin:figma        █░░░░░░░░░░░░░░░░░░░  11   KEEP
vercel        plugin:vercel       ░░░░░░░░░░░░░░░░░░░░   0   DISABLE? ✗
github        plugin:github       ░░░░░░░░░░░░░░░░░░░░   0   DISABLE? ✗
expo          plugin:expo         ░░░░░░░░░░░░░░░░░░░░   0   DISABLE? ✗
```

That's the actual first run on the machine leakhound was built on. It found 3 dead MCP servers, 6 dead plugins, and about 348,000 expensive output tokens spent on mechanical work.

## Quick start

```
/plugin marketplace add srikanth-11/leakhound
/plugin install leakhound@leakhound
```

If you also want the per-prompt router (it registers a hook, see below):

```
/plugin install leakhound-router@leakhound
```

Requires Node.js on PATH. Works on Windows, macOS, and Linux. CI runs every selftest on all three.

## Commands

### `/leakhound:waste`

Parses your session transcript (local JSONL) and reports the top token sinks, worst first:

| Finds | Example | Suggested fix |
|---|---|---|
| Re-read files | `app.ts` read 5 times | reference the earlier read; offset/limit |
| Giant reads | one 25k-token result dump | Grep first, read the slice |
| Retry loops | same command failed 4 times | stop after 2, change approach |
| Verbose output | 12k-token test log | quiet flags, tail |
| Cache churn | prompt cache rebuilding | avoid mid-session config changes |

`/leakhound:waste all` aggregates the last 30 days for the project.

### `/leakhound:mcp-audit`

Takes every configured MCP server (user, project, and plugin-bundled) and checks it against 30 days of actual usage across all your projects. Zero calls in 30 days gets a `DISABLE?` verdict plus the removal command.

### `/leakhound:plugin-audit`

Same idea for installed plugins: component inventory (skills, commands, agents, hooks, bundled MCP servers), an always-on context estimate, and 30 days of real invocations. Verdicts are `KEEP`, `DISABLE?` with the per-session tokens you'd get back, or `HOOK-ONLY` for hook-carrying plugins whose usage can't be measured from transcripts. When leakhound can't measure something, it says so instead of guessing.

### `/leakhound:model-audit [cost|balanced|quality]`

Answers one question: is a top-tier model doing haiku-grade work? It classifies 30 days of assistant messages by tool pattern and output size (an edit wrapped in heavy reasoning counts as complex, not mechanical), maps each model to a tier, and flags mismatches based on your preference:

- `cost` flags top-tier models on mechanical and search work. Aggressive.
- `balanced` flags top-tier on mechanical work only.
- `quality` flips direction: it also flags cheap models doing complex work as a quality risk.

Your choice persists, and the router uses the same weight. The audit also reports delegation compliance: of the times work was handed to a subagent, how often a cheaper model got the job.

Want dollars instead of token counts? Add prices you maintain yourself to `~/.claude/leakhound.json`:

```json
{ "prices": { "top": 25, "mid": 6, "cheap": 1 } }
```

### `/leakhound:trend`

Are the numbers actually improving? Every audit run appends a summary line to `~/.claude/leakhound-history.jsonl`. Trend renders deltas and sparklines over the last 12 runs:

```
mechanicalMsgs       ███▁▁██▅  latest 460      (−322 vs previous)
reallocatableTokens  ███▁▁██▃  latest 347,796  (−1,104,525 vs previous)
```

### `/leakhound-router:router [on|off|status]`

This is the automatic part, and it ships as a separate plugin on purpose: if you only want the audits, you never pay the hook's per-prompt cost. When the router is on, a small hook classifies each prompt (mechanical, search, or complex) and injects a directive telling Claude to run cheap work through a haiku subagent, following your saved weight.

One thing it cannot do, and you should know this before installing: no hook can change the session model. That's a platform rule, not a leakhound choice. What the router moves is the execution work, which is where most of the burn actually is. The main model keeps coordinating.

You can tune classification with your own regex patterns (JSON needs double backslashes; anything in `never` wins):

```json
{
  "routerPatterns": {
    "mechanical": ["\\bregen snapshots?\\b"],
    "search": [],
    "never": ["\\bdeploy\\b"]
  }
}
```

## Configuration

All state lives in one file, `~/.claude/leakhound.json` (or `$CLAUDE_CONFIG_DIR/leakhound.json`):

| Key | Values | Default | Used by |
|---|---|---|---|
| `modelWeight` | `cost` \| `balanced` \| `quality` | `balanced` | model-audit flags, router matrix, subagent delegation |
| `router` | `on` \| `off` | `off` | router hook |
| `routerPatterns` | `{mechanical, search, never}` regex arrays | none | router classification |
| `prices` | `{top, mid, cheap}` USD per M output tokens | none | model-audit dollar figures |

## Privacy

Everything runs locally. No network calls, no telemetry, zero npm dependencies. Reports contain file paths, tool names, model names, and counts. Your transcript content never appears in any output. Don't take my word for it: the whole thing is five small plain-Node scripts, read them.

## How it works

Five zero-dependency Node scripts. Four of them parse `~/.claude/projects/**/*.jsonl` (per-message token usage, tool calls, serving model) plus your MCP and plugin configs. The fifth is the router hook. Command markdown renders their JSON. You can run them directly:

```
node scripts/waste.js --project-dir /path/to/project
node scripts/mcp-audit.js
node scripts/model-audit.js
node scripts/plugin-audit.js
node scripts/trend.js
```

Every script has a `--selftest` flag. CI runs all six on ubuntu, macos, and windows.

## FAQ

**Why not just switch the model automatically?**
Can't be done. No Claude Code hook can change the session model; I checked the hook output schema before building this. Leakhound does the two things that are possible: audits that tell you what to change, and a router that moves execution work to cheaper subagents on its own.

**Will it tell me to disable something I actually use?**
It's built to err toward KEEP. Fuzzy matching over-attributes usage rather than under, hook-only plugins get `HOOK-ONLY` instead of a false `DISABLE?`, and every verdict shows the raw counts so you can judge for yourself. The first false disable verdict I found in testing was leakhound flagging its own router. That's fixed, and it's why the HOOK-ONLY verdict exists.

**What does leakhound itself cost?**
About 253 always-on tokens for the audit plugin, with zero hooks. The router plugin adds one hook that takes roughly 240ms per prompt. That overhead is the whole reason it's a separate opt-in install.

## License

MIT, see [LICENSE](LICENSE).
