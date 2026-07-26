---
name: release
description: Release a new leakhound version - bump manifests, changelog, selftests, dual-branch push, CI check, local install refresh. User-invoked only.
disable-model-invocation: true
---

# Release leakhound

Argument: the new version for the main plugin (e.g. `/release 0.4.4`). If the
router plugin changed too, the user will say so; ask if any `router/` file is
in the diff and the user gave only one version.

Follow the steps in order. Stop and report at the first failure.

1. **Preflight.** `git status` must be clean except the release changes, and
   the current branch must be `main`. `git log origin/main..HEAD` shows what
   ships.
2. **Bump versions.** Set `.claude-plugin/plugin.json` `version` to the
   argument. If any `router/` or `guard/` file changed since the last release, bump that companion's
   manifest too (`router/.claude-plugin/plugin.json` / `guard/.claude-plugin/plugin.json`, patch bump unless told otherwise), and name the companion version in the changelog entry.
   Same-version releases are silent no-ops for installers — the cache only
   refreshes on a version change. Never skip the bump.
3. **Changelog.** Add a `## [<version>] — <today>` entry to `CHANGELOG.md`
   summarizing the actual commits since the previous release. No invented
   features; check `git log` if unsure.
3b. **README examples.** For every behavior change in this release, verify
   the README's worked examples show it: new JSON fields appear in the
   example output blocks, new finding categories appear in the example runs
   and their "What you'd do" lists, new chips/lines are demonstrated. The
   examples are the product demo — a demo that lags the product undersells
   it. Example data stays fictional and internally consistent (recompute
   totals when adding rows).
4. **Selftests.** All eight must print `selftest OK`:
   `node scripts/waste.js --selftest`, `mcp-audit.js`, `model-audit.js`,
   `plugin-audit.js`, `trend.js`, `statusline.js`,
   `node router/scripts/router-hook.js --selftest`, and
   `node guard/scripts/guard-hook.js --selftest`.
5. **Commit and push.** Conventional message, no AI trailers. `git push` on
   `main`.
6. **Sync master.** `master` keeps the full dev history plus internal docs
   and is NEVER pushed: `git checkout master && git checkout main -- . &&
   git commit -m "release <version> (sync from main)" && git checkout main`.
7. **CI.** `gh run list --repo srikanth-11/leakhound --limit 1` — wait for
   the new run, must end `success`.
8. **Refresh local install.**
   `claude plugin marketplace update leakhound`, then
   `claude plugin update leakhound@leakhound` (and
   `leakhound-router@leakhound` / `leakhound-guard@leakhound` if bumped). Verify the reported
   version matches the argument.
9. **Report.** Version, commit hash, CI run result, install status. Remind:
   restart the session to load the new build.
