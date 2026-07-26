---
description: Control leakhound's waste firewall (on|off|status, per-rule toggles)
argument-hint: [on|off|status|artifacts on|off|rereads on|off]
---

Manage the leakhound guard.

0. Any edit to `leakhound.json` goes through a file-editing tool (Read then Edit), never a shell one-liner; after writing, re-read and JSON-parse the file to verify.
1. Argument handling — the guard's state lives in `<CLAUDE_CONFIG_DIR or ~/.claude>/leakhound.json` under the `guard` key:
   - `off` → set `"guard": "off"` (show the exact JSON edit, apply it only with the user's explicit yes).
   - `on` or no argument with no existing key → remove the `guard` key or set `{"artifacts": true, "rereads": true}` (installed = on by default).
   - `status` or bare invocation → read the file and report each rule's state.
   - `artifacts off` / `rereads off` (and `on` variants) → toggle that one rule inside `"guard": {...}`.
2. Report with a chip line: `🛡 Guard ON · artifacts ✅ · rereads ✅` (⚪ OFF when disabled), then one line per rule:
   - artifacts: whole-file reads of lockfiles/build artifacts over ~20k est tokens are denied with a Grep suggestion.
   - rereads: a full re-read of a file unchanged since it was already read this session is denied; offset/limit always passes; a third identical attempt always passes (no hard loops).
3. Honest line when turning on: denials add one quick local check before each Read; nothing is modified or rewritten, reads are only refereed, and every denial explains the cheaper alternative.
4. No raw JSON dumps.
