#!/usr/bin/env node
/* leakhound statusline.js — live context meter for the Claude Code statusline.
   Reads the live transcript's tail (never the whole file) and shows current
   context size, direction, and last-turn output burn. Zero deps, no state
   files, nothing leaves the machine. Configured by the user via settings.json
   (see /leakhound:live); never installed silently. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const TAIL_BYTES = 65536;
// Context-pressure thresholds for the color; heuristic, overridable via
// leakhound.json: {"live": {"yellow": 500000, "red": 800000}}
const DEFAULTS = { yellow: 500000, red: 800000 };

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function thresholds() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'leakhound.json'), 'utf8'));
    const live = cfg && cfg.live;
    if (live && typeof live.yellow === 'number' && typeof live.red === 'number' && live.yellow > 0 && live.red > live.yellow) {
      return { yellow: live.yellow, red: live.red };
    }
  } catch {}
  return DEFAULTS;
}

function fmtTok(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(n);
}

// Parse the tail of a transcript: last two context proxies + last output tokens.
function tailStats(text) {
  const lines = text.split('\n');
  const proxies = [];
  let lastOutput = null;
  // skip lines[0]: likely a partial line cut by the tail window
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('"usage"')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || e.type !== 'assistant' || !e.message || !e.message.usage) continue;
    if (e.isSidechain === true) continue; // subagent lines: their tiny context isn't the session's
    const u = e.message.usage;
    const proxy = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    if (proxy > 0) proxies.push(proxy);
    if (typeof u.output_tokens === 'number') lastOutput = u.output_tokens;
  }
  return {
    ctx: proxies.length ? proxies[proxies.length - 1] : null,
    prev: proxies.length > 1 ? proxies[proxies.length - 2] : null,
    lastOutput
  };
}

function badge(stats, th) {
  if (stats.ctx === null) return '🐕 leakhound';
  const arrow = stats.prev === null ? '' : (stats.ctx > stats.prev ? '↑' : (stats.ctx < stats.prev ? '↓' : '→'));
  let color = '\x1b[32m'; // green
  let warn = '';
  if (stats.ctx >= th.red) { color = '\x1b[31m'; warn = ' compaction near'; }
  else if (stats.ctx >= th.yellow) { color = '\x1b[33m'; warn = ''; }
  const out = stats.lastOutput !== null ? ' · +' + fmtTok(stats.lastOutput) + ' out' : '';
  return '🐕 ' + color + 'ctx ' + fmtTok(stats.ctx) + arrow + warn + '\x1b[0m' + out;
}

function main() {
  let input = '';
  try {
    if (process.stdin.isTTY) return;
    input = fs.readFileSync(0, 'utf8');
  } catch { return; }
  let tp = '';
  try { tp = (JSON.parse(input) || {}).transcript_path || ''; } catch {}
  if (!tp) { console.log('🐕 leakhound'); return; }
  let text = '';
  try {
    const size = fs.statSync(tp).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const fd = fs.openSync(tp, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch { console.log('🐕 leakhound'); return; }
  console.log(badge(tailStats(text), thresholds()));
}

function selftest() {
  const assert = require('assert');
  const mk = (inp, cr, out) => JSON.stringify({
    type: 'assistant',
    message: { id: 'x', usage: { input_tokens: inp, cache_read_input_tokens: cr, cache_creation_input_tokens: 0, output_tokens: out } }
  });
  // first line is treated as partial and skipped — pad with a junk line
  const text = ['PARTIAL', mk(10000, 400000, 800), mk(12000, 600000, 2100)].join('\n');
  const s = tailStats(text);
  assert.equal(s.ctx, 612000, 'latest context proxy');
  assert.equal(s.prev, 410000, 'previous proxy for the arrow');
  assert.equal(s.lastOutput, 2100, 'last-turn output; sidechain line ignored');

  const th = { yellow: 500000, red: 800000 };
  const b = badge(s, th);
  assert(b.includes('612k'), 'formats context in k');
  assert(b.includes('↑'), 'rising context gets the up arrow');
  assert(b.includes('\x1b[33m'), '612k with 500k threshold renders yellow');
  assert(b.includes('+2.1k out') || b.includes('+2k out'), 'last output shown');
  const red = badge({ ctx: 900000, prev: 900000, lastOutput: 50 }, th);
  assert(red.includes('\x1b[31m') && red.includes('compaction near'), 'red zone warns');
  const empty = badge({ ctx: null, prev: null, lastOutput: null }, th);
  assert.equal(empty, '🐕 leakhound', 'no usage yet -> quiet badge');

  assert.equal(fmtTok(999), '999');
  assert.equal(fmtTok(690000), '690k');
  assert.equal(fmtTok(1234567), '1.2M');

  // partial-first-line safety: a corrupted first line must not throw
  const s2 = tailStats('{"type":"assistant","message":{"usage":{"input');
  assert.equal(s2.ctx, null, 'partial-only tail yields quiet stats');

  console.log('selftest OK');
}

if (process.argv.includes('--selftest')) selftest();
else main();
