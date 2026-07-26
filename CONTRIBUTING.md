# Contributing to leakhound

Thanks for looking under the hood. This is a small, strict codebase; the
rules below exist because breaking them has already burned us once.

## Getting started

```
git clone https://github.com/srikanth-11/leakhound
cd leakhound
node scripts/waste.js --selftest
```

No install step. There are no dependencies, and keeping it that way is rule
one. Every script runs on plain Node 18+ on Windows, macOS, and Linux.

Run everything the same way CI does:

```
node scripts/waste.js --selftest
node scripts/mcp-audit.js --selftest
node scripts/model-audit.js --selftest
node scripts/plugin-audit.js --selftest
node scripts/trend.js --selftest
node scripts/statusline.js --selftest
node router/scripts/router-hook.js --selftest
node guard/scripts/guard-hook.js --selftest
```

To try your build as a real plugin: `claude plugin marketplace add <your
clone path>`, install, `/reload-plugins`, run the commands.

## The rules

These are load-bearing. PRs that break them will be asked to change.

1. **Zero dependencies, forever.** No npm packages, in any script, for any
   reason. If stdlib can't do it, we don't do it.
2. **Every behavior change ships a selftest.** Fixtures are built in memory
   with `node:assert`; no test frameworks, no fixture files.
3. **Hooks never break a session.** Anything that runs as a hook
   (router-hook.js, guard-hook.js) must catch every error, print JSON or
   nothing, and exit 0 on any input including garbage. Uncertainty resolves
   to allow/silence. A crashing hook degrades every prompt for every
   installer.
4. **Never touch user data.** Scripts read transcripts and configs; they
   never print transcript content, never edit user files, never make
   network calls. The one exception (the statusline copy) is documented in
   the /live command and stays the only one.
5. **Parse, don't substring.** Anything matched against transcripts goes
   through parsed JSON fields, never raw string search. Transcript content
   is attacker-influenced (fetched webpages end up in tool results); this
   rule is what keeps poisoned content from skewing verdicts.
6. **Bump the version.** Same-version plugin updates silently skip the
   cache copy, so installers keep old code. Any change under a plugin's
   directory bumps that plugin's version and gets a CHANGELOG entry.
7. **Forward slashes in generated paths.** Backslashes get eaten crossing
   shell/JSON layers; node accepts forward slashes on Windows. Settings
   edits go through file tools, never shell one-liners.
8. **Dedupe transcript usage by `message.id`.** Claude Code writes one
   JSONL line per content block, each repeating the same usage object.
   Summing per line triple-counts. This bug shipped once; never again.
9. **README examples move with the product.** Any change to output fields
   or rendering updates the worked examples in the same PR. The examples
   are the demo; a demo that lags the product undersells it.
10. **Err toward KEEP.** When a verdict is uncertain, the audit says so
    (HOOK-ONLY exists for exactly this) or leans conservative. A false
    "disable this" costs a user something real; a false "keep" costs
    nothing.

## Repo layout

- `scripts/` + `commands/` + `skills/` form the main `leakhound` plugin
  (audits, no hooks). `router/` and `guard/` are separate plugins in the
  same marketplace so their hooks stay opt-in.
- Commands are markdown instructions the model follows; scripts do all the
  deterministic work and print JSON. Keep logic in scripts, rendering rules
  in commands.
- `docs/` is intentionally untracked on `main`. Don't add tracked files
  there.

## Submitting

Fork, branch, make the change with its selftest, run all eight selftests,
open a PR against `main` with a short description of what changed and why.
CI runs the suite on three platforms; green CI plus a passing read against
the rules above is what gets merged.
