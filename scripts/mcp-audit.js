#!/usr/bin/env node
/* leakhound mcp-audit.js — which MCP servers do you actually use? Zero deps. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const DAY_MS = 86400000;

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function userConfigPath() {
  return process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json')
    : path.join(os.homedir(), '.claude.json');
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function findFiles(root, filename, maxDepth) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name === filename) out.push(full);
    }
  };
  walk(root, 0);
  return out;
}

// Plugin .mcp.json files come in two formats: wrapped { mcpServers: {...} } and bare
// { "playwright": {...} }. When mcpServers is absent, treat top-level object-valued
// keys as server entries.
function bareServerNames(cfg) {
  const out = {};
  for (const k of Object.keys(cfg)) {
    const v = cfg[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = v;
  }
  return out;
}

function collectServers(opts) {
  const servers = new Map();
  const add = (n, origin, disableHint) => {
    if (!servers.has(n)) servers.set(n, { name: n, origin, disableHint });
  };
  const userCfg = readJson(opts.userConfigPath);
  if (userCfg) {
    for (const n of Object.keys(userCfg.mcpServers || {})) {
      add(n, 'user (~/.claude.json)', 'claude mcp remove "' + n + '" -s user');
    }
    // ~/.claude.json stores projects keys with forward slashes even on Windows.
    const projects = userCfg.projects || {};
    const proj = projects[opts.cwd] || projects[opts.cwd.replace(/\\/g, '/')];
    if (proj) {
      for (const n of Object.keys(proj.mcpServers || {})) {
        add(n, 'project (local scope)', 'claude mcp remove "' + n + '"');
      }
    }
  }
  const projCfg = readJson(path.join(opts.cwd, '.mcp.json'));
  if (projCfg) {
    for (const n of Object.keys(projCfg.mcpServers || {})) {
      add(n, 'project (.mcp.json)', 'remove the entry from .mcp.json');
    }
  }
  for (const f of findFiles(opts.cacheRoot, '.mcp.json', 4)) {
    const cfg = readJson(f);
    // Cache layout is cache/<marketplace>/<plugin>/<version>/.mcp.json — segment [1]
    // is the plugin dir; fall back to [0] if the layout is shallower than expected.
    const parts = path.relative(opts.cacheRoot, f).split(path.sep);
    const plugin = parts[1] || parts[0];
    if (cfg) {
      const serverMap = cfg.mcpServers || bareServerNames(cfg);
      for (const n of Object.keys(serverMap)) {
        add(n, 'plugin:' + plugin, 'disable plugin "' + plugin + '" via /plugin');
      }
    }
  }
  return servers;
}

function countUsage(projectsRoot, days) {
  const cutoff = Date.now() - days * DAY_MS;
  const calls = new Map();
  const lastUsed = new Map();
  let dirs = [];
  try { dirs = fs.readdirSync(projectsRoot); } catch { return { calls, lastUsed }; }
  for (const d of dirs) {
    const dir = path.join(projectsRoot, d);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(dir, f);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;
      let text;
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line.includes('"tool_use"') || !line.includes('mcp__')) continue;
        for (const m of line.matchAll(/"name":"(mcp__[^"]+)"/g)) {
          const rest = m[1].slice(5); // strip "mcp__"
          const i = rest.lastIndexOf('__');
          if (i <= 0) continue;
          const server = rest.slice(0, i);
          calls.set(server, (calls.get(server) || 0) + 1);
          if (st.mtimeMs > (lastUsed.get(server) || 0)) lastUsed.set(server, st.mtimeMs);
        }
      }
    }
  }
  return { calls, lastUsed };
}

function usageFor(name, usage, matchedKeys) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const target = norm(name);
  let total = 0;
  let last = 0;
  for (const [k, v] of usage.calls) {
    const nk = norm(k);
    if (nk === target || nk.endsWith('_' + target) || nk.includes(target)) {
      total += v;
      matchedKeys.add(k);
      const lu = usage.lastUsed.get(k) || 0;
      if (lu > last) last = lu;
    }
  }
  return { total, last };
}

function main() {
  const args = process.argv.slice(2);
  const di = args.indexOf('--project-dir');
  const cwd = di >= 0 && args[di + 1] ? args[di + 1] : process.cwd();
  const servers = collectServers({
    cwd,
    userConfigPath: userConfigPath(),
    cacheRoot: path.join(configDir(), 'plugins', 'cache')
  });
  const usage = countUsage(path.join(configDir(), 'projects'), 30);
  const matchedKeys = new Set();
  const rows = [];
  for (const s of servers.values()) {
    const u = usageFor(s.name, usage, matchedKeys);
    rows.push({
      name: s.name,
      origin: s.origin,
      disableHint: s.disableHint,
      calls30d: u.total,
      lastUsed: u.last ? new Date(u.last).toISOString().slice(0, 10) : null,
      verdict: u.total === 0 ? 'DISABLE?' : 'KEEP'
    });
  }
  for (const [k, v] of usage.calls) {
    if (matchedKeys.has(k)) continue;
    rows.push({
      name: k,
      origin: 'seen in transcripts only (config not found locally)',
      disableHint: null,
      calls30d: v,
      lastUsed: new Date(usage.lastUsed.get(k)).toISOString().slice(0, 10),
      verdict: 'KEEP'
    });
  }
  rows.sort((a, b) => a.calls30d - b.calls30d);
  console.log(JSON.stringify({
    windowDays: 30,
    note: 'Usage counted from local transcripts (last 30 days, all projects). Standing schema cost is not measurable offline and newer Claude Code defers MCP schemas — but zero-call servers still cost startup latency, auth prompts, and clutter. lastUsed dates are file-modification approximations.',
    servers: rows
  }, null, 2));

  // Append history (silent-fail, never blocks output)
  try {
    const disableCount = rows.filter(r => r.verdict === 'DISABLE?').length;
    const totalCalls = rows.reduce((sum, r) => sum + (r.calls30d || 0), 0);
    const summary = { servers: rows.length, disable: disableCount, totalCalls };
    const historyLine = JSON.stringify({
      ts: new Date().toISOString(),
      tool: 'mcp-audit',
      summary
    });
    const historyPath = path.join(configDir(), 'leakhound-history.jsonl');
    let isSymlink = false;
    try { isSymlink = fs.lstatSync(historyPath).isSymbolicLink(); } catch {}
    if (!isSymlink) fs.appendFileSync(historyPath, historyLine + '\n');
  } catch {}
}

function selftest() {
  const assert = require('assert');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leakhound-'));
  const cwd = path.join(tmp, 'proj');
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(tmp, 'claude.json'), JSON.stringify({
    mcpServers: { alpha: {}, beta: {} },
    // ~/.claude.json always keys projects with forward slashes, even on Windows.
    projects: { [cwd.replace(/\\/g, '/')]: { mcpServers: { epsilon: {} } } }
  }));
  fs.writeFileSync(path.join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { gamma: {} } }));
  const pluginDir = path.join(tmp, 'cache', 'mkt', 'plug', 'sha1');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, '.mcp.json'), JSON.stringify({ mcpServers: { delta: {} } }));
  // bare-map format: no mcpServers wrapper, top-level keys are the servers themselves.
  const bareDir = path.join(tmp, 'cache', 'mkt', 'pwplug', 'sha2');
  fs.mkdirSync(bareDir, { recursive: true });
  fs.writeFileSync(path.join(bareDir, '.mcp.json'), JSON.stringify({ playwright: { command: 'npx' } }));
  // wrapped format under its own plugin dir: { "mcpServers": { ... } }
  const wrappedDir = path.join(tmp, 'cache', 'mkt', 'wplug', 'sha3');
  fs.mkdirSync(wrappedDir, { recursive: true });
  fs.writeFileSync(path.join(wrappedDir, '.mcp.json'), JSON.stringify({ mcpServers: { wserver: { command: 'npx' } } }));

  const servers = collectServers({
    cwd,
    userConfigPath: path.join(tmp, 'claude.json'),
    cacheRoot: path.join(tmp, 'cache')
  });
  assert.equal(servers.size, 7, 'alpha, beta, gamma, delta, epsilon, playwright, wserver');
  assert.equal(servers.get('delta').origin, 'plugin:plug', 'origin is the plugin dir, not the marketplace dir');
  assert.equal(servers.get('playwright').origin, 'plugin:pwplug', 'bare-map plugin .mcp.json is read');
  assert.equal(servers.get('wserver').origin, 'plugin:wplug', 'wrapped-format plugin .mcp.json is read with correct plugin origin');
  assert.equal(servers.get('epsilon').origin, 'project (local scope)', 'forward-slash project key matches native cwd');
  assert(servers.get('alpha').disableHint.includes('claude mcp remove'));

  // CLAUDE_CONFIG_DIR overrides where ~/.claude.json is read from.
  const savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = tmp;
  assert.equal(userConfigPath(), path.join(tmp, '.claude.json'), 'CLAUDE_CONFIG_DIR overrides claude.json location');
  if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;

  const projRoot = path.join(tmp, 'projects', 'p1');
  fs.mkdirSync(projRoot, { recursive: true });
  const line = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__alpha__do_thing', input: {} }] }
  });
  fs.writeFileSync(path.join(projRoot, 's.jsonl'), line + '\n' + line + '\n');

  const usage = countUsage(path.join(tmp, 'projects'), 30);
  assert.equal(usage.calls.get('alpha'), 2, 'two alpha calls counted');

  const matched = new Set();
  assert.equal(usageFor('alpha', usage, matched).total, 2);
  assert(matched.size >= 1, 'matched keys recorded');
  assert.equal(usageFor('beta', usage, new Set()).total, 0, 'beta unused');
  // fuzzy: plugin-prefixed transcript names must match plain config names
  usage.calls.set('plugin_figma_figma', 5);
  assert.equal(usageFor('figma', usage, new Set()).total, 5, 'fuzzy plugin-prefix match');
  console.log('selftest OK');
}

if (process.argv.includes('--selftest')) selftest();
else main();
