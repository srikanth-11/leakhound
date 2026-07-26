#!/usr/bin/env node
/* leakhound model-audit.js — is the right model doing the right work? Zero deps. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const DAY_MS = 86400000;
const WEIGHTS = ['cost', 'balanced', 'quality'];

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function projectSlug(cwd) {
  return cwd.replace(/[^a-zA-Z0-9-]/g, '-');
}

function parseMessages(text) {
  const byId = new Map();
  const messages = [];
  const seenDelegationIds = new Set();
  let skipped = 0;
  let anon = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { skipped++; continue; }
    if (!e || e.type !== 'assistant' || !e.message) continue;
    const msg = e.message;
    if (tierOf(msg.model || '') === null) continue;
    const id = msg.id || ('anon-' + (anon++));
    let rec = byId.get(id);
    if (!rec) {
      rec = { id, model: msg.model, tools: new Set(), outputTokens: 0, inputTokens: 0, cacheCreationTokens: 0, delegations: [], counted: false };
      byId.set(id, rec);
      messages.push(rec);
    }
    if (!rec.counted && msg.usage) {
      rec.outputTokens += msg.usage.output_tokens || 0;
      rec.inputTokens += msg.usage.input_tokens || 0;
      rec.cacheCreationTokens += msg.usage.cache_creation_input_tokens || 0;
      rec.counted = true;
    }
    for (const b of (Array.isArray(msg.content) ? msg.content : [])) {
      if (b && b.type === 'tool_use' && b.name) {
        rec.tools.add(b.name);
        if (b.name === 'Task' || b.name === 'Agent') {
          if (!seenDelegationIds.has(b.id)) {
            rec.delegations.push(tierOf((b.input && b.input.model) || '') || 'unspecified');
            seenDelegationIds.add(b.id);
          }
        }
      }
    }
  }
  return { messages, skipped };
}

function bucketOf(toolNames, outputTokens) {
  const out = outputTokens || 0;
  if (toolNames.size === 0) return 'prose';
  const SEARCH = new Set(['Read', 'Grep', 'Glob']);
  const MECH = new Set(['Edit', 'Write', 'NotebookEdit']);
  const BIG = new Set(['Task', 'Agent']);
  let allSearch = true;
  let hasMech = false;
  let hasBig = false;
  for (const t of toolNames) {
    if (!SEARCH.has(t)) allSearch = false;
    if (MECH.has(t)) hasMech = true;
    if (BIG.has(t)) hasBig = true;
  }
  if (allSearch) return 'search';
  if (hasMech && !hasBig) {
    for (const t of toolNames) {
      if (!MECH.has(t) && !SEARCH.has(t) && t !== 'Bash' && t !== 'PowerShell') return 'complex';
    }
    // heavy output alongside edit tools isn't mechanical — a big rewrite, not a tweak
    return out >= 1500 ? 'complex' : 'mechanical';
  }
  return 'complex';
}

function tierOf(model) {
  const m = (model || '').toLowerCase();
  if (m.includes('haiku')) return 'cheap';
  if (m.includes('sonnet')) return 'mid';
  if (m.includes('opus') || m.includes('fable') || m.includes('mythos')) return 'top';
  return null;
}

function flagsFor(weight, rows) {
  const wants = {
    cost: [['top', 'mechanical'], ['top', 'search'], ['mid', 'mechanical']],
    balanced: [['top', 'mechanical']],
    quality: [['cheap', 'complex'], ['top', 'mechanical']]
  }[weight] || [];
  const flags = [];
  for (const [tier, bucket] of wants) {
    const hits = rows.filter(r => r.tier === tier && r.bucket === bucket);
    if (!hits.length) continue;
    const suggestion = tier === 'cheap'
      ? 'quality risk: complex work on a cheap model — consider sonnet or the session model'
      : (bucket === 'search'
        ? 'delegate search sweeps to a haiku subagent'
        : 'delegate mechanical edits to a haiku subagent (or /model for the session)');
    flags.push({
      model: [...new Set(hits.map(r => r.model))].join(', '),
      tier,
      bucket,
      messages: hits.length,
      estOutputTokens: hits.reduce((s, r) => s + r.outputTokens, 0),
      estInputTokens: hits.reduce((s, r) => s + (r.inputTokens || 0), 0),
      suggestion
    });
  }
  flags.sort((a, b) => b.estOutputTokens - a.estOutputTokens);
  return flags;
}

function loadWeight(configPath) {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (cfg && WEIGHTS.includes(cfg.modelWeight)) return cfg.modelWeight;
  } catch {}
  return 'balanced';
}

function saveWeight(configPath, w) {
  let cfg = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (parsed && typeof parsed === 'object') cfg = parsed;
  } catch {}
  cfg.modelWeight = w;
  try { fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2)); } catch {}
}

function priceFor(tier, prices) {
  if (!prices || typeof prices !== 'object') return null;
  const v = prices[tier];
  return (typeof v === 'number' && isFinite(v)) ? v : null;
}

function delegationOf(messages) {
  let events = 0, cheapModel = 0, midModel = 0, unspecified = 0;
  for (const m of messages) {
    for (const t of (m.delegations || [])) {
      events++;
      if (t === 'cheap') cheapModel++;
      else if (t === 'mid') midModel++;
      else unspecified++;
    }
  }
  return {
    events, cheapModel, midModel, unspecified,
    compliancePct: Math.round(100 * (cheapModel + midModel) / Math.max(1, events))
  };
}

function fixtureLines() {
  const L = [];
  // one top-tier mechanical message split across 2 lines (same id) — usage must count once
  const mk = (id, model, block, out) => JSON.stringify({
    type: 'assistant',
    message: { id, model, content: [block], usage: { output_tokens: out, input_tokens: 40, cache_creation_input_tokens: 60 } }
  });
  L.push(mk('m1', 'claude-fable-5', { type: 'tool_use', id: 't1', name: 'Edit', input: {} }, 200));
  L.push(mk('m1', 'claude-fable-5', { type: 'text', text: 'done' }, 200));
  // top-tier search message
  L.push(mk('m2', 'claude-opus-5', { type: 'tool_use', id: 't2', name: 'Grep', input: {} }, 150));
  // cheap-tier complex message (Bash => complex)
  L.push(mk('m3', 'claude-haiku-4-5', { type: 'tool_use', id: 't3', name: 'Bash', input: {} }, 100));
  // mid-tier prose message
  L.push(mk('m4', 'claude-sonnet-5', { type: 'text', text: 'analysis' }, 50));
  // synthetic model line — must be skipped from perModel
  L.push(mk('m5', '<synthetic>', { type: 'text', text: 'err' }, 10));
  // top-tier delegation to a cheap subagent
  L.push(mk('m6', 'claude-fable-5', { type: 'tool_use', id: 't6', name: 'Agent', input: { model: 'haiku', prompt: 'x' } }, 100));
  // top-tier delegation tool_use repeated across 2 lines under the SAME message id, SAME
  // tool_use id (t7) — simulates a re-sent snapshot; delegationOf must dedup to one event
  L.push(mk('m7', 'claude-fable-5', { type: 'tool_use', id: 't7', name: 'Agent', input: { model: 'haiku', prompt: 'y' } }, 100));
  L.push(mk('m7', 'claude-fable-5', { type: 'tool_use', id: 't7', name: 'Agent', input: { model: 'haiku', prompt: 'y' } }, 100));
  L.push('garbage line');
  return L.join('\n');
}

function selftest() {
  const assert = require('assert');
  const { messages, skipped } = parseMessages(fixtureLines());
  assert.equal(skipped, 1, 'one malformed line skipped');
  assert.equal(messages.length, 6, 'm1..m4, m6, m7 kept, synthetic m5 dropped');
  const m1 = messages.find(m => m.id === 'm1');
  assert.equal(m1.outputTokens, 200, 'same-id lines counted once');
  assert.equal(m1.inputTokens, 40, 'input tokens deduped: counted once despite 2 lines');
  assert.equal(m1.cacheCreationTokens, 60, 'cache creation tokens deduped: counted once despite 2 lines');
  assert.deepEqual([...m1.tools].sort(), ['Edit'], 'tools merged across id lines');

  const m6 = messages.find(m => m.id === 'm6');
  assert.deepEqual(m6.delegations, ['cheap'], 'Agent tool_use with model:haiku records a cheap delegation');

  const m7 = messages.find(m => m.id === 'm7');
  assert.equal(m7.outputTokens, 100, 'm7 usage counted once despite the tool_use repeating across 2 lines');
  assert.deepEqual(m7.delegations, ['cheap'], 'tool_use id t7 repeated across 2 lines dedups to a single delegation event');

  assert.deepEqual(delegationOf(messages), { events: 2, cheapModel: 2, midModel: 0, unspecified: 0, compliancePct: 100 }, 'delegationOf tallies delegation events by tier (m6 + m7; t7 repeat does not double-count)');

  assert.equal(priceFor('top', { top: 25, mid: 6, cheap: 1 }), 25);
  assert.equal(priceFor('top', null), null);
  assert.equal(priceFor('top', { top: 'x' }), null);

  assert.equal(bucketOf(new Set()), 'prose');
  assert.equal(bucketOf(new Set(['Read', 'Grep'])), 'search');
  assert.equal(bucketOf(new Set(['Edit', 'Read'])), 'mechanical');
  assert.equal(bucketOf(new Set(['Edit', 'Task'])), 'complex');
  assert.equal(bucketOf(new Set(['Bash'])), 'complex');
  assert.equal(bucketOf(new Set(['Edit']), 5000), 'complex', 'heavy output never mechanical');
  assert.equal(bucketOf(new Set(['Edit']), 200), 'mechanical');

  assert.equal(tierOf('claude-fable-5'), 'top');
  assert.equal(tierOf('claude-opus-5'), 'top');
  assert.equal(tierOf('claude-sonnet-5'), 'mid');
  assert.equal(tierOf('claude-haiku-4-5'), 'cheap');
  assert.equal(tierOf('<synthetic>'), null);

  const rows = messages.map(m => ({
    model: m.model, tier: tierOf(m.model), bucket: bucketOf(m.tools, m.outputTokens),
    outputTokens: m.outputTokens, inputTokens: m.inputTokens
  }));
  const costFlags = flagsFor('cost', rows);
  // cost: top+mechanical (m1), top+search (m2) — haiku complex and sonnet prose unflagged
  assert.equal(costFlags.length, 2, 'cost weight: two flags');
  const balFlags = flagsFor('balanced', rows);
  assert.equal(balFlags.length, 1, 'balanced: only top+mechanical');
  assert.equal(balFlags[0].estOutputTokens, 200);
  assert.equal(balFlags[0].estInputTokens, 40, 'flag carries input tokens');
  const qFlags = flagsFor('quality', rows);
  // quality: cheap+complex (m3, quality-risk) + top+mechanical (m1)
  assert.equal(qFlags.length, 2, 'quality: risk flag + top mechanical');
  assert(qFlags.some(f => f.suggestion.includes('quality risk')), 'quality-risk suggestion present');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leakhound-'));
  const cfg = path.join(tmp, 'leakhound.json');
  assert.equal(loadWeight(cfg), 'balanced', 'missing file defaults balanced');
  saveWeight(cfg, 'cost');
  assert.equal(loadWeight(cfg), 'cost', 'saved weight round-trips');
  fs.writeFileSync(cfg, '{bad json');
  assert.equal(loadWeight(cfg), 'balanced', 'corrupt file defaults balanced');
  console.log('selftest OK');
}

function main() {
  const args = process.argv.slice(2);
  const di = args.indexOf('--project-dir');
  const cwd = di >= 0 && args[di + 1] ? args[di + 1] : process.cwd();
  const wi = args.indexOf('--weight');
  const configPath = path.join(configDir(), 'leakhound.json');
  const cfg = (function () {
    try { const c = JSON.parse(fs.readFileSync(configPath, 'utf8')); return c && typeof c === 'object' ? c : {}; } catch { return {}; }
  })();
  const prices = (cfg.prices && ['top', 'mid', 'cheap'].every(k => typeof cfg.prices[k] === 'number' && isFinite(cfg.prices[k]))) ? cfg.prices : null;
  let weight;
  if (wi >= 0 && WEIGHTS.includes(args[wi + 1])) {
    weight = args[wi + 1];
    saveWeight(configPath, weight);
  } else {
    weight = loadWeight(configPath);
  }
  const dir = path.join(configDir(), 'projects', projectSlug(cwd));
  if (!fs.existsSync(dir)) {
    console.log(JSON.stringify({ error: 'no transcripts found at ' + dir }));
    return;
  }
  const cutoff = Date.now() - 30 * DAY_MS;
  let files = [];
  try {
    files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const full = path.join(dir, f);
        let mtime = 0;
        try { mtime = fs.statSync(full).mtimeMs; } catch {}
        return { full, name: f, mtime };
      });
  } catch { files = []; }
  files = files.filter(f => f.mtime >= cutoff);
  if (!files.length) {
    console.log(JSON.stringify({ error: 'no .jsonl transcripts in ' + dir + ' within 30 days' }));
    return;
  }
  const all = [];
  let skippedLines = 0;
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f.full, 'utf8'); } catch { skippedLines++; continue; }
    const { messages, skipped } = parseMessages(text);
    skippedLines += skipped;
    all.push(...messages);
  }
  const rows = all.map(m => ({
    model: m.model, tier: tierOf(m.model), bucket: bucketOf(m.tools, m.outputTokens),
    outputTokens: m.outputTokens, inputTokens: m.inputTokens, cacheCreationTokens: m.cacheCreationTokens
  }));
  const perModelMap = new Map();
  const buckets = { mechanical: 0, search: 0, prose: 0, complex: 0 };
  for (const r of rows) {
    buckets[r.bucket]++;
    const k = r.model;
    if (!perModelMap.has(k)) perModelMap.set(k, { model: k, tier: r.tier, messages: 0, outputTokens: 0, inputTokens: 0, cacheCreationTokens: 0 });
    const pm = perModelMap.get(k);
    pm.messages++;
    pm.outputTokens += r.outputTokens;
    pm.inputTokens += r.inputTokens;
    pm.cacheCreationTokens += r.cacheCreationTokens;
  }
  if (prices) {
    for (const pm of perModelMap.values()) {
      pm.estCostUSD = +(pm.outputTokens / 1e6 * priceFor(pm.tier, prices)).toFixed(2);
    }
  }
  const flags = flagsFor(weight, rows);
  if (prices) {
    for (const f of flags) {
      f.estCostUSD = +(f.estOutputTokens / 1e6 * priceFor(f.tier, prices)).toFixed(2);
    }
  }
  const topOutputTokens = [...perModelMap.values()].filter(pm => pm.tier === 'top').reduce((s, pm) => s + pm.outputTokens, 0);
  const reallocatableTokens = flags.filter(f => f.tier !== 'cheap').reduce((s, f) => s + f.estOutputTokens, 0);
  const reallocatableInputTokens = flags.filter(f => f.tier !== 'cheap').reduce((s, f) => s + f.estInputTokens, 0);
  const delegation = delegationOf(all);
  const out = {
    weight,
    windowDays: 30,
    files: files.map(f => f.name),
    perModel: [...perModelMap.values()].sort((a, b) => b.outputTokens - a.outputTokens),
    buckets,
    flags,
    reallocatableTokens,
    reallocatableInputTokens,
    delegation,
    skippedLines,
    note: 'Buckets are tool-pattern heuristics; mechanical additionally requires modest output (<1500 est tokens) — edit-only tool calls with heavy output are classified complex, since heavy output signals real drafting, not a mechanical tweak. Output tokens are the spend proxy. Input tokens are mostly cache writes/reads, a secondary signal. Delegation counts Task/Agent tool_use calls by target model tier; unspecified means inherited (no model set) or an explicit top-tier model. The session model changes only via /model — the automatic lever is subagent delegation per the leakhound skill. USD figures use prices you maintain in leakhound.json and only appear when configured.'
  };
  if (prices) out.reallocatableUSD = +(reallocatableTokens / 1e6 * prices.top).toFixed(2);
  console.log(JSON.stringify(out, null, 2));

  try {
    fs.appendFileSync(path.join(configDir(), 'leakhound-history.jsonl'), JSON.stringify({
      ts: new Date().toISOString(), tool: 'model-audit',
      summary: { weight, topOutputTokens, mechanicalMsgs: buckets.mechanical, reallocatableTokens }
    }) + '\n');
  } catch {}
}

if (process.argv.includes('--selftest')) selftest();
else main();
