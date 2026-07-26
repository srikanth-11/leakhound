#!/usr/bin/env node
/* leakhound plugin-audit.js — which installed plugins earn their context cost? Zero deps. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const DAY_MS = 86400000;

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function collectPlugins(installedPath) {
  const data = readJson(installedPath);
  const out = [];
  if (!data || !data.plugins) return out;
  for (const key of Object.keys(data.plugins)) {
    const at = key.lastIndexOf('@');
    if (at <= 0) continue;
    const entries = data.plugins[key];
    if (!Array.isArray(entries) || !entries.length || !entries[0].installPath) continue;
    out.push({ name: key.slice(0, at), marketplace: key.slice(at + 1), installPath: entries[0].installPath });
  }
  return out;
}

function frontmatterMeta(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return '';
    let meta = '';
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(name|description):\s*(.*)$/);
      if (kv) meta += kv[2];
    }
    return meta;
  } catch { return ''; }
}

function inventory(installPath) {
  const inv = { skills: 0, commands: 0, agents: 0, mcpServers: 0, hooks: 0, alwaysOnTokensEst: 0, skillNames: [], agentNames: [] };
  let chars = 0;
  try {
    const skillsDir = path.join(installPath, 'skills');
    for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const f = path.join(skillsDir, d.name, 'SKILL.md');
      if (fs.existsSync(f)) { inv.skills++; inv.skillNames.push(d.name); chars += d.name.length + frontmatterMeta(f).length; }
    }
  } catch {}
  for (const [dir, key] of [['commands', 'commands'], ['agents', 'agents']]) {
    try {
      for (const f of fs.readdirSync(path.join(installPath, dir))) {
        if (!f.endsWith('.md')) continue;
        inv[key]++;
        if (key === 'agents') inv.agentNames.push(f.slice(0, -3));
        chars += f.length + frontmatterMeta(path.join(installPath, dir, f)).length;
      }
    } catch {}
  }
  const mcp = readJson(path.join(installPath, '.mcp.json'));
  if (mcp) {
    const servers = mcp.mcpServers && typeof mcp.mcpServers === 'object'
      ? Object.keys(mcp.mcpServers)
      : Object.keys(mcp).filter(k => mcp[k] && typeof mcp[k] === 'object');
    inv.mcpServers = servers.length;
    chars += servers.join('').length;
  }
  inv.alwaysOnTokensEst = Math.round(chars / 4);
  const pluginMeta = readJson(path.join(installPath, '.claude-plugin', 'plugin.json'));
  inv.hooks = (pluginMeta && pluginMeta.hooks && typeof pluginMeta.hooks === 'object' && Object.keys(pluginMeta.hooks).length)
    ? Object.keys(pluginMeta.hooks).length
    : 0;
  return inv;
}

// Hooks carry no skill/command/MCP/agent marker in transcripts, so a hook-only plugin
// always shows 0 invocations. Route those to HOOK-ONLY instead of a false DISABLE?.
function verdictFor(inv, used, name) {
  if (used > 0) return { verdict: 'KEEP', hint: null };
  if (inv.hooks > 0) {
    return { verdict: 'HOOK-ONLY', hint: "carries hooks — usage not measurable from transcripts; disable only if you don't want its hook behavior" };
  }
  return { verdict: 'DISABLE?', hint: 'disable via /plugin (or claude plugin disable ' + name + ')' };
}

// Needle shapes are matched structurally against parsed JSONL entries, not against raw
// line text — a plain substring match would also fire inside tool_result content (e.g.
// poisoned web content quoting "<command-name>/x:y" or "mcp__plugin_x_"), inflating
// counts for plugins that were never actually invoked. The line.includes() prefilters
// below stay as a cheap gate so we only pay for JSON.parse on lines that could match.
function buildNeedle(name, skillNames, agentNames) {
  const mcpPrefix = 'mcp__plugin_' + name + '_';
  const skillPrefix = name + ':';
  const commandMarker = '<command-name>/' + name + ':';
  const prefilter = [
    '"skill":"' + name + ':',
    commandMarker,
    mcpPrefix,
    '"subagent_type":"' + name + ':'
  ];
  for (const sn of skillNames) prefilter.push('"skill":"' + sn + '"');
  for (const an of agentNames) prefilter.push('"subagent_type":"' + an + '"');
  return { name, prefilter, mcpPrefix, skillPrefix, skillNames, agentNames, commandMarker };
}

function matchesPlugin(entry, nd) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.type === 'assistant' && entry.message && Array.isArray(entry.message.content)) {
    for (const b of entry.message.content) {
      if (!b || b.type !== 'tool_use') continue;
      if (typeof b.name === 'string' && b.name.startsWith(nd.mcpPrefix)) return true;
      const input = (b.input && typeof b.input === 'object') ? b.input : {};
      if (typeof input.skill === 'string' && (input.skill.startsWith(nd.skillPrefix) || nd.skillNames.includes(input.skill))) return true;
      if (typeof input.subagent_type === 'string' && (input.subagent_type.startsWith(nd.skillPrefix) || nd.agentNames.includes(input.subagent_type))) return true;
    }
    return false;
  }
  if (entry.type === 'user' && entry.message && typeof entry.message.content === 'string') {
    return entry.message.content.includes(nd.commandMarker);
  }
  return false;
}

function countInvocations(projectsRoot, days, needles) {
  const cutoff = Date.now() - days * DAY_MS;
  const counts = new Map();
  let dirs = [];
  try { dirs = fs.readdirSync(projectsRoot); } catch { return counts; }
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
        if (!line) continue;
        const candidates = [];
        for (const nd of needles) {
          for (const tk of nd.prefilter) {
            if (line.includes(tk)) { candidates.push(nd); break; }
          }
        }
        if (!candidates.length) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        for (const nd of candidates) {
          if (matchesPlugin(entry, nd)) {
            counts.set(nd.name, (counts.get(nd.name) || 0) + 1);
          }
        }
      }
    }
  }
  return counts;
}

function main() {
  const installedPath = path.join(configDir(), 'plugins', 'installed_plugins.json');
  const plugins = collectPlugins(installedPath);
  if (!plugins.length) {
    console.log(JSON.stringify({ error: 'no installed plugins found at ' + installedPath }));
    return;
  }
  const invByPlugin = new Map();
  const needles = plugins.map(p => {
    const inv = inventory(p.installPath);
    invByPlugin.set(p.name, inv);
    return buildNeedle(p.name, inv.skillNames, inv.agentNames);
  });
  const counts = countInvocations(path.join(configDir(), 'projects'), 30, needles);
  const rows = plugins.map(p => {
    const inv = invByPlugin.get(p.name);
    const used = counts.get(p.name) || 0;
    const { verdict, hint } = verdictFor(inv, used, p.name);
    return {
      name: p.name,
      marketplace: p.marketplace,
      components: { skills: inv.skills, commands: inv.commands, agents: inv.agents, mcpServers: inv.mcpServers, hooks: inv.hooks },
      alwaysOnTokensEst: inv.alwaysOnTokensEst,
      invocations30d: used,
      verdict,
      hint
    };
  }).sort((a, b) => a.invocations30d - b.invocations30d);
  console.log(JSON.stringify({
    windowDays: 30,
    plugins: rows,
    note: 'Invocations counted from local transcripts (last 30 days, all projects): skill calls, slash commands, bundled MCP tools, plugin agents — bare (unprefixed) skill/agent names are matched too, not just plugin-prefixed forms. Always-on estimate = component names + descriptions that ship every session; hook and instruction costs are not measurable offline. Line-level counting: one transcript line with multiple invocation markers of the same plugin counts once. Hook-only plugins (no skill/command/MCP/agent surface) can\'t be usage-measured this way and are marked HOOK-ONLY instead of DISABLE?.'
  }, null, 2));

  // Append history (silent-fail, never blocks output)
  try {
    const disableCount = rows.filter(r => r.verdict === 'DISABLE?').length;
    const reclaimableTokens = rows.filter(r => r.verdict === 'DISABLE?').reduce((sum, r) => sum + (r.alwaysOnTokensEst || 0), 0);
    const summary = { plugins: rows.length, disable: disableCount, reclaimableTokens };
    const historyLine = JSON.stringify({
      ts: new Date().toISOString(),
      tool: 'plugin-audit',
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
  // fake plugin cache: one skill, one command, one agent, one bare mcp config
  const pdir = path.join(tmp, 'cache', 'mkt', 'alpha', '1.0.0');
  fs.mkdirSync(path.join(pdir, 'skills', 'boom'), { recursive: true });
  fs.writeFileSync(path.join(pdir, 'skills', 'boom', 'SKILL.md'),
    '---\nname: boom\ndescription: goes boom loudly\n---\nbody');
  fs.mkdirSync(path.join(pdir, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(pdir, 'commands', 'bang.md'), '---\ndescription: bang bang\n---\nrun');
  fs.mkdirSync(path.join(pdir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(pdir, 'agents', 'scout.md'), '---\ndescription: scouts ahead\n---\nagent');
  fs.writeFileSync(path.join(pdir, '.mcp.json'), JSON.stringify({ boomserver: { command: 'npx' } }));

  const installed = path.join(tmp, 'installed_plugins.json');
  fs.writeFileSync(installed, JSON.stringify({
    version: 2,
    plugins: {
      'alpha@mkt': [{ scope: 'user', installPath: pdir, version: '1.0.0' }],
      'beta@mkt': [{ scope: 'user', installPath: path.join(tmp, 'nope'), version: '0' }]
    }
  }));

  const plugins = collectPlugins(installed);
  assert.equal(plugins.length, 2);
  assert.deepEqual(plugins[0], { name: 'alpha', marketplace: 'mkt', installPath: pdir });

  const inv = inventory(pdir);
  assert.equal(inv.skills, 1);
  assert.equal(inv.commands, 1);
  assert.equal(inv.agents, 1);
  assert.equal(inv.mcpServers, 1);
  assert.deepEqual(inv.skillNames, ['boom']);
  assert.deepEqual(inv.agentNames, ['scout']);
  assert(inv.alwaysOnTokensEst > 0, 'metadata estimate positive');
  assert.equal(inv.hooks, 0, 'alpha has no plugin.json → hooks 0');
  const invMissing = inventory(path.join(tmp, 'nope'));
  assert.equal(invMissing.skills + invMissing.commands + invMissing.agents + invMissing.mcpServers, 0, 'missing dir → zero inventory, no throw');
  assert.deepEqual(invMissing.skillNames, []);
  assert.deepEqual(invMissing.agentNames, []);
  assert.equal(invMissing.hooks, 0, 'missing dir → hooks 0, no throw');

  // fake plugin cache: hook-only plugin (e.g. leakhound-router shape) — no skill/command/agent/mcp surface
  const hookyDir = path.join(tmp, 'cache', 'mkt', 'hooky', '1.0.0');
  fs.mkdirSync(path.join(hookyDir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(hookyDir, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'hooky',
    hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'noop' }] }] }
  }));
  const invHooky = inventory(hookyDir);
  assert.equal(invHooky.hooks, 1, 'hooky has one hook event key');
  assert.equal(invHooky.skills + invHooky.commands + invHooky.agents + invHooky.mcpServers, 0, 'hooky has no other components');

  // fake transcript: alpha invoked via skill, command, mcp, agent, and a bare (unprefixed) skill; beta never
  const projRoot = path.join(tmp, 'projects', 'p1');
  fs.mkdirSync(projRoot, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'alpha:boom' } }] } }),
    JSON.stringify({ type: 'user', message: { content: '<command-message>x</command-message><command-name>/alpha:bang</command-name>' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'mcp__plugin_alpha_boomserver__go', input: {} }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't3', name: 'Agent', input: { subagent_type: 'alpha:scout' } }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't4', name: 'Skill', input: { skill: 'boom' } }] } }),
    // poisoning attempt: tool_result-shaped content quoting both a command-name marker and
    // an mcp__plugin_ marker for "beta" — neither is a real tool_use/command invocation, so
    // structural matching (not raw substring matching) must not count it.
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_result', tool_use_id: 'poison1', content: '<command-name>/beta:evil</command-name> mcp__plugin_beta_x__go' }] } })
  ];
  fs.writeFileSync(path.join(projRoot, 's.jsonl'), lines.join('\n'));

  const counts = countInvocations(path.join(tmp, 'projects'), 30, [
    buildNeedle('alpha', inv.skillNames, inv.agentNames),
    buildNeedle('beta', invMissing.skillNames, invMissing.agentNames)
  ]);
  assert.equal(counts.get('alpha'), 5, 'four prefixed shapes + one bare skill invocation counted');
  assert.equal(counts.get('beta') || 0, 0, 'beta unused, and poisoned tool_result content does not inflate the count');

  // verdict: hook-only plugin with zero measured invocations must not read as DISABLE?
  const hookyVerdict = verdictFor(invHooky, 0, 'hooky');
  assert.equal(hookyVerdict.verdict, 'HOOK-ONLY', 'hook-carrying plugin with 0 invocations → HOOK-ONLY, not DISABLE?');
  // beta: no hooks, zero invocations → still DISABLE? as before
  const betaVerdict = verdictFor(invMissing, counts.get('beta') || 0, 'beta');
  assert.equal(betaVerdict.verdict, 'DISABLE?', 'no hooks, unused → DISABLE? unchanged');

  console.log('selftest OK');
}

if (process.argv.includes('--selftest')) selftest();
else main();
