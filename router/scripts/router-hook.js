#!/usr/bin/env node
/* leakhound router-hook.js — per-prompt model-fit directive (UserPromptSubmit hook) + /router toggle. Zero deps. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}
function configPath() {
  return path.join(configDir(), 'leakhound.json');
}
function readConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return (c && typeof c === 'object') ? c : {};
  } catch { return {}; }
}
// Writes to a temp file then renames over the target, and refuses to touch a symlinked
// target — a malicious symlink at configPath() could otherwise redirect this write to
// overwrite an arbitrary file the process has access to.
function safeWrite(filePath, content) {
  try {
    try {
      if (fs.lstatSync(filePath).isSymbolicLink()) return;
    } catch {}
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, filePath);
  } catch {}
}

function writeConfig(cfg) {
  try {
    const dir = configDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {}
  safeWrite(configPath(), JSON.stringify(cfg, null, 2));
}

const MECH = /\b(typo|rename|reword|bump|indent|reformat|format (this|the|that)|add (a )?comment|remove (a |the )?comment|delete (this|the) (file|line|import|comment)|change (the )?(text|string|label|color|value|name)|update (the )?version|one[- ]?liner)\b/i;
const SEARCH = /\b(where (is|are)|find (all|the|every)|list (all|the)|show (me )?(all|usages|references|every)|grep|search for|which files?|locate|how many (files|places|usages))\b/i;
const COMPLEX = /\b(design|architect|plan|debug|investigate|review|refactor|migrate|why|optimi[sz]e|security|implement|build)\b/i;

function compilePatterns(cfg) {
  const out = { mech: [], search: [], never: [] };
  const src = (cfg && cfg.routerPatterns && typeof cfg.routerPatterns === 'object') ? cfg.routerPatterns : {};
  const fill = (key, dest) => {
    const arr = Array.isArray(src[key]) ? src[key] : [];
    for (const s of arr) {
      if (typeof s !== 'string') continue;
      try { out[dest].push(new RegExp(s, 'i')); } catch {}
    }
  };
  fill('mechanical', 'mech');
  fill('search', 'search');
  fill('never', 'never');
  return out;
}

function classify(prompt, pats) {
  const p = (prompt || '').trim();
  const x = pats || { mech: [], search: [], never: [] };
  if (!p || p.startsWith('/')) return 'skip';
  if (x.never.some(r => r.test(p))) return 'complex';
  if (COMPLEX.test(p)) return 'complex';
  if (x.mech.some(r => r.test(p)) && p.length < 200) return 'mechanical';
  if (x.search.some(r => r.test(p))) return 'search';
  if (MECH.test(p) && p.length < 200) return 'mechanical';
  if (SEARCH.test(p)) return 'search';
  return 'complex';
}

function shouldInject(weight, cls) {
  if (cls === 'mechanical') return weight === 'cost' || weight === 'balanced';
  if (cls === 'search') return weight === 'cost';
  return false;
}

function directive(cls, weight) {
  return '[leakhound router] Prompt classified as ' + cls + ' (weight: ' + weight + '). ' +
    'Execute the ' + cls + ' work via a haiku subagent (Agent tool, model "haiku") and keep main-loop coordination minimal. ' +
    'If the task proves non-trivial midway, escalate to the session model instead of degrading quality.';
}

function runHook() {
  try {
    if (process.stdin.isTTY) return;
    let input = '';
    try { input = fs.readFileSync(0, 'utf8'); } catch {}
    let prompt = '';
    try { prompt = (JSON.parse(input) || {}).prompt || ''; } catch {}
    const cfg = readConfig();
    if (cfg.router !== 'on') return;
    const weight = ['cost', 'balanced', 'quality'].includes(cfg.modelWeight) ? cfg.modelWeight : 'balanced';
    const cls = classify(prompt, compilePatterns(cfg));
    if (cls === 'skip' || !shouldInject(weight, cls)) return;
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: directive(cls, weight) }
    }));
  } catch {}
}

function setRouter(v) {
  const cfg = readConfig();
  cfg.router = v;
  writeConfig(cfg);
  console.log(JSON.stringify({ router: v, modelWeight: cfg.modelWeight || 'balanced' }));
}

function status() {
  const cfg = readConfig();
  console.log(JSON.stringify({ router: cfg.router === 'on' ? 'on' : 'off', modelWeight: cfg.modelWeight || 'balanced' }));
}

function selftest() {
  const assert = require('assert');
  assert.equal(classify('fix the typo in README'), 'mechanical');
  assert.equal(classify('rename getUser to fetchUser'), 'mechanical');
  assert.equal(classify('where is the auth middleware defined'), 'search');
  assert.equal(classify('design a caching layer for the API'), 'complex');
  assert.equal(classify('debug why login fails'), 'complex');
  assert.equal(classify('/leakhound:waste'), 'skip');
  assert.equal(classify(''), 'skip');
  assert.equal(classify('review the typo fixes'), 'complex', 'COMPLEX overrides MECH');
  assert.equal(classify('x'.repeat(250) + ' fix typo'), 'complex', 'long prompts never mechanical');

  const pats = compilePatterns({ routerPatterns: { mechanical: [String.raw`\bregen snapshots?\b`], search: [], never: [String.raw`\bdeploy\b`] } });
  assert.equal(classify('regen snapshots for the ui tests', pats), 'mechanical');
  assert.equal(classify('regen snapshots then deploy', pats), 'complex', 'never beats custom mechanical');
  assert.equal(classify('fix the typo before deploy', pats), 'complex', 'never beats built-in mechanical');
  const bad = compilePatterns({ routerPatterns: { mechanical: ['[invalid', 42] } });
  assert.equal(bad.mech.length, 0, 'invalid regex and non-string skipped');

  assert.equal(shouldInject('cost', 'mechanical'), true);
  assert.equal(shouldInject('cost', 'search'), true);
  assert.equal(shouldInject('balanced', 'mechanical'), true);
  assert.equal(shouldInject('balanced', 'search'), false);
  assert.equal(shouldInject('quality', 'mechanical'), false);
  assert.equal(shouldInject('quality', 'complex'), false);
  assert.equal(shouldInject('cost', 'complex'), false);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leakhound-'));
  process.env.CLAUDE_CONFIG_DIR = tmp;
  setRouter('on');
  const cfg = JSON.parse(fs.readFileSync(path.join(tmp, 'leakhound.json'), 'utf8'));
  assert.equal(cfg.router, 'on', 'router flag persisted');
  setRouter('off');
  const cfg2 = JSON.parse(fs.readFileSync(path.join(tmp, 'leakhound.json'), 'utf8'));
  assert.equal(cfg2.router, 'off');

  // symlink safety: if leakhound.json is a symlink pointing elsewhere, setRouter must not
  // write through it. Symlink creation needs a privilege Windows doesn't grant by default,
  // so skip the assert (not the whole selftest) when it can't be created.
  let symlinked = false;
  const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leakhound-'));
  const targetFile = path.join(linkDir, 'target.json');
  const targetContent = '{"untouched":true}';
  fs.writeFileSync(targetFile, targetContent);
  const linkPath = path.join(linkDir, 'leakhound.json');
  try {
    fs.symlinkSync(targetFile, linkPath);
    symlinked = true;
  } catch {}
  if (symlinked) {
    const savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = linkDir;
    setRouter('on');
    assert.equal(fs.readFileSync(targetFile, 'utf8'), targetContent, 'symlinked leakhound.json must not redirect the write to its target');
    if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
  }

  console.log('selftest OK');
}

const args = process.argv.slice(2);
if (args.includes('--selftest')) selftest();
else if (args.includes('--status')) status();
else if (args.includes('--set')) {
  const v = args[args.indexOf('--set') + 1];
  if (v === 'on' || v === 'off') setRouter(v);
  else console.log(JSON.stringify({ error: 'use --set on|off' }));
} else runHook();
