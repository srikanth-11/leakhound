#!/usr/bin/env node
/* leakhound guard-hook.js — waste firewall. PreToolUse referee for Read:
   blocks whole-file reads of lockfiles/build artifacts, and repeat full reads
   of files unchanged since they were already read this session. Deny reasons
   always name the escape hatch (offset/limit passes; a repeat attempt passes).
   HOOK CONTRACT: never crashes, never blocks the session, JSON-only stdout,
   exit 0 always; any uncertainty resolves to ALLOW. Zero deps. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ARTIFACT_RE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|[\\/](dist|build|out|node_modules|coverage|\.next)[\\/]|\.min\.(js|css)$|\.map$)/i;
const ARTIFACT_MIN_BYTES = 80000; // ~20k est tokens
const STATE_TTL_MS = 24 * 3600 * 1000;

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function guardCfg() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(configDir(), 'leakhound.json'), 'utf8'));
    const g = c && c.guard;
    if (g === 'off') return { artifacts: false, rereads: false };
    if (g && typeof g === 'object') return { artifacts: g.artifacts !== false, rereads: g.rereads !== false };
  } catch {}
  return { artifacts: true, rereads: true }; // installing the guard is the opt-in
}

function stateDir() {
  return path.join(configDir(), '.leakhound-guard');
}

function statePath(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^a-zA-Z0-9-]/g, '');
  return path.join(stateDir(), safe + '.json');
}

function loadState(sessionId) {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(sessionId), 'utf8'));
    if (s && typeof s === 'object') return { reads: s.reads || {}, denials: s.denials || {} };
  } catch {}
  return { reads: {}, denials: {} };
}

function saveState(sessionId, st) {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(statePath(sessionId), JSON.stringify(st));
  } catch {}
}

function pruneOldState() {
  try {
    const dir = stateDir();
    const cutoff = Date.now() - STATE_TTL_MS;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      try { if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full); } catch {}
    }
  } catch {}
}

// Pure-ish decision core, selftestable. Returns {action:'allow'} or
// {action:'deny', reason} and mutates/saves state as needed.
function decide(evt) {
  if (!evt || typeof evt !== 'object') return { action: 'allow' };
  const input = evt.tool_input || {};
  const fp = input.file_path;
  if (!fp || typeof fp !== 'string') return { action: 'allow' };

  if (evt.hook_event_name === 'PostToolUse') {
    // record successful-looking full reads so the re-read rule has memory
    if (input.offset == null && input.limit == null) {
      try {
        const m = fs.statSync(fp).mtimeMs;
        const st = loadState(evt.session_id);
        st.reads[fp] = { mtime: m, full: true };
        saveState(evt.session_id, st);
      } catch {}
    }
    return { action: 'allow' };
  }

  // PreToolUse from here. Sliced reads always pass — they are the escape hatch.
  if (input.offset != null || input.limit != null) return { action: 'allow' };
  const cfg = guardCfg();

  if (cfg.artifacts && ARTIFACT_RE.test(fp)) {
    try {
      const size = fs.statSync(fp).size;
      if (size > ARTIFACT_MIN_BYTES) {
        const base = path.basename(fp);
        return {
          action: 'deny',
          reason: 'leakhound-guard: ' + base + ' is a lockfile/build artifact (~' + Math.round(size / 4000) + 'k est tokens). Do NOT retry this exact read. Grep it for the entry you need, or re-run with offset/limit to force a slice.'
        };
      }
    } catch {}
  }

  if (cfg.rereads) {
    const st = loadState(evt.session_id);
    const rec = st.reads[fp];
    if (rec && rec.full) {
      try {
        const m = fs.statSync(fp).mtimeMs;
        if (m === rec.mtime) {
          const d = st.denials[fp] || 0;
          if (d >= 1) {
            // circuit breaker at ONE denial per file: subagents share the parent session id and may legitimately need a first read of a file the parent already saw — one nudge, then pass
            delete st.denials[fp];
            saveState(evt.session_id, st);
            return { action: 'allow' };
          }
          st.denials[fp] = d + 1;
          saveState(evt.session_id, st);
          const base = path.basename(fp);
          return {
            action: 'deny',
            reason: 'leakhound-guard: ' + base + ' was already fully read this session and has not changed. Do NOT retry this exact read — reference the earlier read, or use offset/limit for the section you need. (If you genuinely need the full file, repeat the read and it will pass.)'
          };
        }
        // file changed since the read: allow and refresh memory
        st.reads[fp] = { mtime: m, full: true };
        delete st.denials[fp];
        saveState(evt.session_id, st);
      } catch {}
    }
  }
  return { action: 'allow' };
}

function main() {
  try {
    if (process.stdin.isTTY) return;
    let evt = null;
    try { evt = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }
    pruneOldState();
    const d = decide(evt);
    if (d.action === 'deny') {
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: d.reason
        }
      }));
    }
  } catch {}
}

function selftest() {
  const assert = require('assert');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-guard-'));
  process.env.CLAUDE_CONFIG_DIR = tmp;
  const sid = 'testsession';

  // artifact firewall
  const lock = path.join(tmp, 'package-lock.json');
  fs.writeFileSync(lock, 'x'.repeat(100000));
  const denyLock = decide({ hook_event_name: 'PreToolUse', session_id: sid, tool_input: { file_path: lock } });
  assert.equal(denyLock.action, 'deny', 'big lockfile whole-read denied');
  assert(denyLock.reason.includes('Grep'), 'reason names the alternative');
  const small = path.join(tmp, 'yarn.lock');
  fs.writeFileSync(small, 'tiny');
  assert.equal(decide({ hook_event_name: 'PreToolUse', session_id: sid, tool_input: { file_path: small } }).action, 'allow', 'small artifact passes');
  assert.equal(decide({ hook_event_name: 'PreToolUse', session_id: sid, tool_input: { file_path: lock, limit: 100 } }).action, 'allow', 'offset/limit always passes');

  // re-read denier with mtime memory + circuit breaker
  const src = path.join(tmp, 'app.ts');
  fs.writeFileSync(src, 'code');
  assert.equal(decide({ hook_event_name: 'PreToolUse', session_id: sid, tool_input: { file_path: src } }).action, 'allow', 'first read passes');
  decide({ hook_event_name: 'PostToolUse', session_id: sid, tool_input: { file_path: src } }); // record it
  assert.equal(decide({ hook_event_name: 'PreToolUse', session_id: sid, tool_input: { file_path: src } }).action, 'deny', 'unchanged re-read denied (1)');
  assert.equal(decide({ hook_event_name: 'PreToolUse', session_id: sid, tool_input: { file_path: src } }).action, 'allow', 'circuit breaker: one denial per file, repeat passes (subagent-safe)');

  // changed file re-reads freely
  const src2 = path.join(tmp, 'lib.ts');
  fs.writeFileSync(src2, 'v1');
  decide({ hook_event_name: 'PostToolUse', session_id: sid, tool_input: { file_path: src2 } });
  fs.writeFileSync(src2, 'v2 changed');
  // two writes can land in the same mtime tick; force a distinct mtime so the
  // "changed file" branch is what's actually under test
  const bump = new Date(Date.now() + 2000);
  fs.utimesSync(src2, bump, bump);
  assert.equal(decide({ hook_event_name: 'PreToolUse', session_id: sid, tool_input: { file_path: src2 } }).action, 'allow', 'changed file passes');

  // config off
  fs.writeFileSync(path.join(tmp, 'leakhound.json'), JSON.stringify({ guard: 'off' }));
  assert.equal(decide({ hook_event_name: 'PreToolUse', session_id: sid, tool_input: { file_path: lock } }).action, 'allow', 'guard off allows everything');
  fs.writeFileSync(path.join(tmp, 'leakhound.json'), JSON.stringify({ guard: { artifacts: true, rereads: false } }));
  assert.equal(decide({ hook_event_name: 'PreToolUse', session_id: sid, tool_input: { file_path: src } }).action, 'allow', 'rereads rule individually off');
  assert.equal(decide({ hook_event_name: 'PreToolUse', session_id: sid, tool_input: { file_path: lock } }).action, 'deny', 'artifacts rule still on');

  // hostile inputs resolve to allow
  assert.equal(decide(null).action, 'allow');
  assert.equal(decide({}).action, 'allow');
  assert.equal(decide({ hook_event_name: 'PreToolUse', tool_input: { file_path: path.join(tmp, 'missing-file.json') } }).action, 'allow', 'missing file allows');

  console.log('selftest OK');
}

if (process.argv.includes('--selftest')) selftest();
else main();
