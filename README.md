# leakhound

![selftests](https://github.com/srikanth-11/leakhound/actions/workflows/selftest.yml/badge.svg)
![license](https://img.shields.io/badge/license-MIT-green)
![zero deps](https://img.shields.io/badge/dependencies-0-blue)

Token-waste forensics for Claude Code. Leakhound finds out where your tokens actually go and hands you the exact command to fix each leak.

## Overview

Existing tools tell you how much you spent. ccusage gives totals, `/context` gives a snapshot. Neither answers the questions that decide whether your plan survives the afternoon: why did this session burn 400k tokens, which of your MCP servers and plugins are dead weight, and is an expensive model doing work a cheap one handles fine?

Leakhound answers all three, locally, with zero dependencies. The audits themselves are plain scripts, not model calls, so running leakhound costs roughly nothing. It started as a fix for one developer's Pro plan dying by lunch; the first audit of the machine it was built on found 3 dead MCP servers, 6 dead plugins, and about 348,000 expensive output tokens spent on mechanical work.

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
| Compaction waste | context squashed, files re-read after | /clear between tasks, split long sessions |

It also warns before the damage: a context-pressure signal fires when recent
input is averaging high enough that compaction is coming, and with `all` it
compares your latest session against your own 30-day median.

**Usage:** `/leakhound:waste` for the latest session, `/leakhound:waste all` for the last 30 days.

**Example run.** A session that refactored an API layer comes back like this:

```diff
- file-reread     ████████████████████  38,400   src/api/routes.ts read 6 times
- giant-read      ██████████░░░░░░░░░░  30,100   Read package-lock.json returned ~30k tokens
- retry-loop      ████░░░░░░░░░░░░░░░░  12,700   Bash failed 5x in a row
- verbose-output  ███░░░░░░░░░░░░░░░░░  10,900   Bash output ~10.9k tokens
```

Estimated recoverable: ~92,100 tokens.

**What you'd do with that:**

1. `file-reread`: tell Claude "stop re-reading routes.ts, reference the earlier read" or ask it to read only the changed section with offset/limit. Biggest single win here.
2. `giant-read`: lockfiles and build artifacts almost never need a full read. Ask Claude to Grep for the one package it cares about.
3. `retry-loop`: five identical failures means the approach was wrong at attempt two. Interrupt earlier; the tokens after that were pure loss.
4. `verbose-output`: test runs should go through quiet flags (`--reporter=dot`, `2>&1 | tail -20`) before they hit the transcript.

A clean session gets a single green line instead.

### Command: `/leakhound:mcp-audit`

**What it does:** checks every configured MCP server (user, project, and plugin-bundled) against 30 days of actual usage across all your projects. Zero calls in 30 days gets a `DISABLE?` verdict plus the removal command.

**Usage:** `/leakhound:mcp-audit`

**Example run.** A typical setup that accumulated servers over a few months:

🟢 3 keep · 🔴 3 disable candidates

```diff
- postgres      ░░░░░░░░░░░░░░░░░░░░    0  never
- sentry        ░░░░░░░░░░░░░░░░░░░░    0  never
- browserstack  ░░░░░░░░░░░░░░░░░░░░    0  never
+ linear        ██░░░░░░░░░░░░░░░░░░   14  2026-07-20
+ slack         █████████░░░░░░░░░░░   89  2026-07-24
+ github        ████████████████████  212  2026-07-25
```

**What you'd do with that:**

1. `postgres` was added for a project that shipped months ago: `claude mcp remove "postgres" -s user`
2. `sentry` came bundled with a plugin you use for other things: disable just the server in `/plugin` settings, keep the plugin.
3. `browserstack`, honestly forgotten: remove it, re-add in a minute if a project ever needs it again.
4. The three KEEP rows need nothing. That's the point of the green.

### Command: `/leakhound:plugin-audit`

**What it does:** the same treatment for installed plugins. Component inventory (skills, commands, agents, hooks, bundled MCP servers), an always-on context estimate, and 30 days of real invocations. Verdicts are `KEEP`, `DISABLE?` with the per-session tokens you'd get back, or `HOOK-ONLY` for hook-carrying plugins whose usage can't be measured from transcripts. When leakhound can't measure something, it says so instead of guessing.

**Usage:** `/leakhound:plugin-audit`

**Example run:**

🟢 2 keep · 🔴 2 disable candidates · 🟡 1 hook-only

```diff
- docs-toolkit      ░░░░░░░░░░░░░░░░░░░░    0  ~950 tok
- theme-pack        ░░░░░░░░░░░░░░░░░░░░    0  ~310 tok
  session-guard     ░░░░░░░░░░░░░░░░░░░░    0  ~25 tok  (hook-only)
+ code-review       ███░░░░░░░░░░░░░░░░░   37  ~480 tok
+ commit-helpers    ████████████████████  203  ~60 tok
```

Reclaimable every session: ~1,260 tokens (estimate).

**What you'd do with that:**

1. `docs-toolkit` and `theme-pack` haven't fired in a month and cost ~1,260 tokens of context every single session: disable both in `/plugin`. That's headroom back on every prompt from now on.
2. `session-guard` is hook-only: its work never shows in transcripts, so leakhound refuses to call it dead. Keep it if you want its hook behavior; that's your call, not the audit's.
3. Run `/leakhound:trend` next week to watch the reclaimable number drop to zero.

### Command: `/leakhound:model-audit [cost|balanced|quality]`

**What it does:** answers one question: is a top-tier model doing haiku-grade work? Classifies 30 days of assistant messages by tool pattern and output size (an edit wrapped in heavy reasoning counts as complex, not mechanical), maps each model to a tier, and flags mismatches based on your preference:

- `cost` flags top-tier models on mechanical and search work. Aggressive.
- `balanced` flags top-tier on mechanical work only.
- `quality` flips direction: it also flags cheap models doing complex work as a quality risk.

Your choice persists, and the router uses the same weight. The audit also reports delegation compliance: of the times work went to a subagent, how often a cheaper model got the job.

**Usage:** `/leakhound:model-audit cost` (argument saves the preference; omit it to reuse the saved one)

**Example run** with weight `cost`:

```diff
  claude-opus-4-8   top  ████████████████████  1,240,000 out  95,000 in  $31.00
  claude-haiku-4-5  cheap ██░░░░░░░░░░░░░░░░░░   130,000 out  12,000 in   $0.13
```

Buckets: `mechanical █████ search ███ prose ██ complex ██████████`

🔴 Delegation: 41 events, 22% to cheaper models

```diff
- top+mechanical  ████████████████████  610,000  (480 msgs)
- top+search      ██████░░░░░░░░░░░░░░  185,000  (140 msgs)
```

Reallocatable: ~795,000 output tokens, roughly $19.90 at your configured prices.

**What you'd do with that:**

1. That 22% delegation number is the real finding: work is going to subagents, but they inherit the expensive model. Install the router (`/plugin install leakhound-router@leakhound`, then `/leakhound-router:router on`) so mechanical and search prompts carry a haiku directive automatically.
2. For a session you know will be grunt work (renames, config edits, migrations), switch the whole session: `/model sonnet`.
3. Re-run the audit in a week. Delegation % up, reallocatable down = it's working. Flat = check `/leakhound:trend` and tighten `routerPatterns`.

Prefer dollars over token counts, like the $ figures above? Add prices you maintain yourself to `~/.claude/leakhound.json`:

```json
{ "prices": { "top": 25, "mid": 6, "cheap": 1 } }
```

### Command: `/leakhound:trend`

**What it does:** shows whether the numbers are improving. Every audit run appends a summary line to `~/.claude/leakhound-history.jsonl`; trend renders deltas and sparklines over the last 12 runs. Rows are direction-aware: a falling waste metric renders green even though the delta is negative.

**Usage:** `/leakhound:trend`

**Example run.** Two weeks after acting on the audits above:

```diff
+ disable              █▅▅▁▁     latest 0        (-3 vs previous)
+ reclaimableTokens    █▅▅▁▁     latest 0        (-1,260 vs previous)
+ mechanicalMsgs       ███▅▃▂    latest 210      (-95 vs previous)
+ reallocatableTokens  ███▅▃▂    latest 118,000  (-64,000 vs previous)
  totalCalls           ▃▄▄▅▅     latest 402      (+23 vs previous)
```

🟢 trending leaner

**What you'd do with that:** nothing. All green is the receipt that the disables and the router actually worked. If a row flips red later, whatever you installed or changed that week is the suspect.

### Command: `/leakhound-router:router [on|off|status]`

**What it does:** the automatic part, shipped as a separate plugin on purpose: audit-only installs never pay the hook's per-prompt cost. When on, a small hook classifies each prompt (mechanical, search, or complex) and injects a directive telling Claude to run cheap work through a haiku subagent, following your saved weight.

One thing it cannot do, worth knowing before you install: no hook can change the session model. That's a platform rule, not a leakhound choice. The router moves the execution work, which is where most of the burn actually is.

**Usage:** `/leakhound-router:router on`

**Example run:**

```
🟢 Router ON · weight cost
mechanical ✅  search ✅  complex —
```

**What happens next:** you type "rename getUser to fetchUser everywhere". The hook classifies it mechanical and quietly tells Claude to do the renaming in a haiku subagent. Your expensive session model writes a couple of coordination lines instead of forty edit calls. You type "design the caching layer" and the hook stays silent, because that one deserves the big model. If a prompt gets misrouted, the directive includes an escape hatch: Claude escalates back to the session model rather than shipping a worse answer.

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
