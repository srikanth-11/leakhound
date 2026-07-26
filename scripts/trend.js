#!/usr/bin/env node
/* leakhound trend.js — audit trends and deltas. Zero deps. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function sparkline(values) {
  const GLYPHS = '▁▂▃▄▅▆▇█';
  const v = values.slice(-12);
  if (!v.length) return '';
  const min = Math.min(...v), max = Math.max(...v);
  if (max === min) return '▄'.repeat(v.length);
  return v.map(n => GLYPHS[Math.round((n - min) / (max - min) * 7)]).join('');
}

function buildTrend(lines) {
  const byTool = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || !e.tool || !e.summary) continue;
    if (!byTool.has(e.tool)) byTool.set(e.tool, []);
    byTool.get(e.tool).push(e);
  }
  const tools = {};
  for (const [tool, runs] of byTool) {
    const latest = runs[runs.length - 1];
    const previous = runs.length > 1 ? runs[runs.length - 2] : null;
    const deltas = {};
    const spark = {};
    for (const k of Object.keys(latest.summary)) {
      if (typeof latest.summary[k] !== 'number') continue;
      if (previous && typeof previous.summary[k] === 'number') deltas[k] = latest.summary[k] - previous.summary[k];
      spark[k] = sparkline(runs.map(r => r.summary[k]).filter(n => typeof n === 'number'));
    }
    tools[tool] = { runs: runs.length, latest, previous, deltas: previous ? deltas : null, spark };
  }
  return tools;
}

function main() {
  const historyPath = path.join(configDir(), 'leakhound-history.jsonl');
  let content;
  try {
    content = fs.readFileSync(historyPath, 'utf8');
  } catch {
    console.log(JSON.stringify({ error: 'no history yet — run the audits first' }));
    process.exit(0);
  }
  if (!content.trim()) {
    console.log(JSON.stringify({ error: 'no history yet — run the audits first' }));
    process.exit(0);
  }
  const lines = content.split('\n');
  const tools = buildTrend(lines);
  if (!Object.keys(tools).length) {
    console.log(JSON.stringify({ error: 'no history yet — run the audits first' }));
    process.exit(0);
  }
  console.log(JSON.stringify({
    tools,
    note: 'History accumulates each time an audit runs. Deltas compare the two most recent runs; sparklines cover up to the last 12.'
  }, null, 2));
  process.exit(0);
}

function selftest() {
  const assert = require('assert');

  // Test sparkline: [1,2,3] should be '▁▅█'
  // min=1, max=3, range=2
  // (1-1)/2*7 = 0 → Math.round(0) = 0 → '▁'
  // (2-1)/2*7 = 3.5 → Math.round(3.5) = 4 → '▅'
  // (3-1)/2*7 = 7 → Math.round(7) = 7 → '█'
  assert.equal(sparkline([1, 2, 3]), '▁▅█', 'sparkline [1,2,3] → ▁▅█');

  // Test all-equal series
  assert.equal(sparkline([5, 5, 5]), '▄▄▄', 'sparkline [5,5,5] → ▄▄▄');

  // Test empty
  assert.equal(sparkline([]), '', 'sparkline [] → empty');

  // Test single value
  assert.equal(sparkline([42]), '▄', 'sparkline [42] → ▄');

  // Test last 12 values (slice behavior)
  const long = Array.from({length: 20}, (_, i) => i + 1);
  const result = sparkline(long);
  assert.equal(result.length, 12, 'sparkline takes last 12 values');

  // Test buildTrend with fixture
  const fixtureLines = [
    JSON.stringify({ ts: '2026-07-25T10:00:00Z', tool: 'mcp-audit', summary: { servers: 5, disable: 1, calls30d: 20 } }),
    JSON.stringify({ ts: '2026-07-25T10:05:00Z', tool: 'mcp-audit', summary: { servers: 5, disable: 1, calls30d: 22 } }),
    JSON.stringify({ ts: '2026-07-25T10:10:00Z', tool: 'mcp-audit', summary: { servers: 5, disable: 1, calls30d: 25 } }),
    JSON.stringify({ ts: '2026-07-25T10:15:00Z', tool: 'plugin-audit', summary: { plugins: 8, disable: 2, reclaimableTokens: 5000 } }),
    'not valid json',
    ''
  ];

  const tools = buildTrend(fixtureLines);

  // mcp-audit should have 3 runs
  assert.equal(tools['mcp-audit'].runs, 3, 'mcp-audit has 3 runs');

  // plugin-audit should have 1 run
  assert.equal(tools['plugin-audit'].runs, 1, 'plugin-audit has 1 run');

  // mcp-audit latest calls30d should be 25
  assert.equal(tools['mcp-audit'].latest.summary.calls30d, 25, 'mcp-audit latest calls30d is 25');

  // mcp-audit previous calls30d should be 22
  assert.equal(tools['mcp-audit'].previous.summary.calls30d, 22, 'mcp-audit previous calls30d is 22');

  // mcp-audit delta should be 25-22 = 3
  assert.equal(tools['mcp-audit'].deltas.calls30d, 3, 'mcp-audit delta is 3');

  // plugin-audit should have null deltas (only 1 run)
  assert.equal(tools['plugin-audit'].deltas, null, 'plugin-audit deltas is null');

  // Check sparklines exist
  assert(tools['mcp-audit'].spark.calls30d, 'mcp-audit has calls30d sparkline');
  assert.equal(tools['mcp-audit'].spark.calls30d.length, 3, 'mcp-audit sparkline has 3 chars (3 runs)');

  console.log('selftest OK');
}

if (process.argv.includes('--selftest')) selftest();
else main();
