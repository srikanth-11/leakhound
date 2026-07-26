# leakhound

![selftests](https://github.com/srikanth-11/leakhound/actions/workflows/selftest.yml/badge.svg)
![license](https://img.shields.io/badge/license-MIT-green)
![zero deps](https://img.shields.io/badge/dependencies-0-blue)

Token-waste forensics for Claude Code. Leakhound finds out where your tokens actually go and hands you the exact command to fix each leak.

## Overview

Existing tools tell you how much you spent. ccusage gives totals, `/context` gives a snapshot. Neither answers the questions that decide whether your plan survives the afternoon: why did this session burn 400k tokens, which of your MCP servers and plugins are dead weight, and is an expensive model doing work a cheap one handles fine?

Leakhound answers all three, locally, with zero dependencies. It started as a fix for one developer's Pro plan dying by lunch; the first audit of the machine it was built on found 3 dead MCP servers, 6 dead plugins, and about 348,000 expensive output tokens spent on mechanical work.

🟢 5 keep · 🔴 3 disable candidates

```diff
- vercel        ░░░░░░░░░░░░░░░░░░░░    0  never
- github        ░░░░░░░░░░░░░░░░░░░░    0  never
- expo          ░░░░░░░░░░░░░░░░░░░░    0  never
+ figma         █░░░░░░░░░░░░░░░░░░░   11  2026-07-19
+ playwright    ████████████████████  360  2026-07-23
```

Red rows are dead weight, green rows earn their keep. Output looks like this in your terminal too.

## Installation

```
/plugin marketplace add srikanth-11/leakhound
/plugin install leakhound@leakhound
```

Optional companion, only if you want the automatic per-prompt router (it registers a hook):

```
/plugin install leakhound-router@leakhound
```

Requires Node.js on PATH. Works on Windows, macOS, and Linux; CI runs every selftest on all three.

## Features

### Command: `/leakhound:waste`

**What it does:** parses your session transcript (local JSONL) and reports the top token sinks, worst first, each with a fix.

| Finds | Example | Suggested fix |
|---|---|---|
| Re-read files | `app.ts` read 5 times | reference the earlier read; offset/limit |
| Giant reads | one 25k-token result dump | Grep first, read the slice |
| Retry loops | same command failed 4 times | stop after 2, change approach |
| Verbose output | 12k-token test log | quiet flags, tail |
| Cache churn | prompt cache rebuilding | avoid mid-session config changes |

**Usage:** `/leakhound:waste` for the latest session, `/leakhound:waste all` for the last 30 days.

**Example output:**

```diff
- cache-churn     ████████████████████  240,000
- giant-read      ██░░░░░░░░░░░░░░░░░░   25,000
- verbose-output  █░░░░░░░░░░░░░░░░░░░   12,000
```

A clean session gets a single green line instead.

### Command: `/leakhound:mcp-audit`

**What it does:** checks every configured MCP server (user, project, and plugin-bundled) against 30 days of actual usage across all your projects. Zero calls in 30 days gets a `DISABLE?` verdict plus the removal command.

**Usage:** `/leakhound:mcp-audit`

### Command: `/leakhound:plugin-audit`

**What it does:** the same treatment for installed plugins. Component inventory (skills, commands, agents, hooks, bundled MCP servers), an always-on context estimate, and 30 days of real invocations. Verdicts are `KEEP`, `DISABLE?` with the per-session tokens you'd get back, or `HOOK-ONLY` for hook-carrying plugins whose usage can't be measured from transcripts. When leakhound can't measure something, it says so instead of guessing.

**Usage:** `/leakhound:plugin-audit`

**Example output:**

```diff
- mcp-apps          ░░░░░░░░░░░░░░░░░░░░    0  ~428 tok
  leakhound-router  ░░░░░░░░░░░░░░░░░░░░    0  ~17 tok  (hook-only)
+ superpowers       ██░░░░░░░░░░░░░░░░░░   41  ~611 tok
+ playwright        ████████████████████  489  ~3 tok
```

### Command: `/leakhound:model-audit [cost|balanced|quality]`

**What it does:** answers one question: is a top-tier model doing haiku-grade work? Classifies 30 days of assistant messages by tool pattern and output size (an edit wrapped in heavy reasoning counts as complex, not mechanical), maps each model to a tier, and flags mismatches based on your preference:

- `cost` flags top-tier models on mechanical and search work. Aggressive.
- `balanced` flags top-tier on mechanical work only.
- `quality` flips direction: it also flags cheap models doing complex work as a quality risk.

Your choice persists, and the router uses the same weight. The audit also reports delegation compliance: of the times work went to a subagent, how often a cheaper model got the job.

**Usage:** `/leakhound:model-audit cost` (argument saves the preference; omit it to reuse the saved one)

Prefer dollars over token counts? Add prices you maintain yourself to `~/.claude/leakhound.json`:

```json
{ "prices": { "top": 25, "mid": 6, "cheap": 1 } }
```

### Command: `/leakhound:trend`

**What it does:** shows whether the numbers are improving. Every audit run appends a summary line to `~/.claude/leakhound-history.jsonl`; trend renders deltas and sparklines over the last 12 runs. Rows are direction-aware: a falling waste metric renders green even though the delta is negative.

**Usage:** `/leakhound:trend`

**Example output:**

```diff
+ mechanicalMsgs       ███▁▁██▅  latest 460      (-322 vs previous)
+ reallocatableTokens  ███▁▁██▃  latest 347,796  (-1,104,525 vs previous)
  topOutputTokens      ███▁▁███  latest 3,109,773 (+31,626 vs previous)
```

Closes with a verdict chip: 🟢 trending leaner, 🔴 trending heavier, or ⚪ flat.

### Command: `/leakhound-router:router [on|off|status]`

**What it does:** the automatic part, shipped as a separate plugin on purpose: audit-only installs never pay the hook's per-prompt cost. When on, a small hook classifies each prompt (mechanical, search, or complex) and injects a directive telling Claude to run cheap work through a haiku subagent, following your saved weight.

One thing it cannot do, worth knowing before you install: no hook can change the session model. That's a platform rule, not a leakhound choice. The router moves the execution work, which is where most of the burn actually is.

**Usage:** `/leakhound-router:router on`

```
🟢 Router ON · weight balanced
mechanical ✅  search —  complex —
```

Tune classification with your own regex patterns (JSON needs double backslashes; anything in `never` wins):

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

Everything runs locally. No network calls, no telemetry, zero npm dependencies. Reports contain file paths, tool names, model names, and counts. Your transcript content never appears in any output. Don't take our word for it: the whole thing is five small plain-Node scripts, read them.

## How it works

Five zero-dependency Node scripts. Four parse `~/.claude/projects/**/*.jsonl` (per-message token usage, tool calls, serving model) plus your MCP and plugin configs. The fifth is the router hook. Command markdown renders their JSON. You can run them directly:

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
Can't be done. No Claude Code hook can change the session model; we checked the hook output schema before building this. Leakhound does the two things that are possible: audits that tell you what to change, and a router that moves execution work to cheaper subagents on its own.

**Will it tell me to disable something I actually use?**
It's built to err toward KEEP. Fuzzy matching over-attributes usage rather than under, hook-only plugins get `HOOK-ONLY` instead of a false `DISABLE?`, and every verdict shows the raw counts so you can judge for yourself. The first false disable verdict found in testing was leakhound flagging its own router. That's fixed, and it's why the HOOK-ONLY verdict exists.

**What does leakhound itself cost?**
About 253 always-on tokens for the audit plugin, with zero hooks. The router plugin adds one hook that takes roughly 240ms per prompt. That overhead is the whole reason it's a separate opt-in install.

## License

MIT, see [LICENSE](LICENSE).
