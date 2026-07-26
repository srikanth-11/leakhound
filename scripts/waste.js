#!/usr/bin/env node
/* leakhound waste.js — find token waste in Claude Code session transcripts. Zero deps. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const DAY_MS = 86400000;
const T = {
  giantRead: 20000,       // est tokens in one tool_result
  verbose: 10000,         // est tokens of shell output
  rereadCount: 3,         // reads of same file to flag
  retryRun: 3,            // consecutive same-tool failures to flag
  churnMinCreation: 50000,
  churnRatio: 0.5,
  compactDropRatio: 0.3,  // context drop share signalling a compaction
  compactDropAbs: 20000,  // ...and the drop must also exceed this many tokens
  pressureAvg: 50000,     // rolling-window avg context that signals pressure
  pressureWindow: 5
};

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function projectSlug(cwd) {
  return cwd.replace(/[^a-zA-Z0-9-]/g, '-');
}

function estTokens(str) {
  return Math.round((str || '').length / 4);
}

// Findings descriptions are built from file_path/tool-name strings that can come straight
// from transcript content (e.g. a giant-read's file_path) — strip control chars so a path
// can't inject newlines/escapes into rendered output, and cap length defensively.
function clean(s) {
  return String(s).replace(/[\r\n\t\x00-\x1f]/g, ' ').slice(0, 200);
}

// Known quiet flags for noisy tools; lets verbose-output fixes name the exact flag.
const QUIET_FLAGS = [
  [/\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bjest\b|\bvitest\b/i, '--reporter=dot (or --silent)'],
  [/\bpytest\b/i, '-q'],
  [/\bcargo\s+(test|build|check)\b/i, '--quiet'],
  [/\bplaywright\s+test\b/i, '--reporter=line'],
  [/\bgo\s+test\b/i, 'drop -v'],
  [/\b(gradle|gradlew|mvn)\b/i, '-q']
];
function quietFlagFor(cmd) {
  for (const [re, flag] of QUIET_FLAGS) if (re.test(cmd || '')) return flag;
  return null;
}

// Lockfiles, build output, minified bundles: files nobody should ever read whole.
const ARTIFACT_RE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|[\\/](dist|build|out|node_modules|coverage|\.next)[\\/]|\.min\.(js|css)$|\.map$)/i;

function baseName(p) {
  const s = String(p || '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(b => (b && typeof b.text === 'string') ? b.text : '').join('');
  }
  return '';
}

function parseTranscriptText(text) {
  const events = [];
  let skipped = 0;
  // Claude Code writes one assistant JSONL line per content block; every line for
  // the same turn repeats identical message.usage under the same message.id. Count
  // each id once so totals aren't inflated by the number of content blocks.
  const seenUsageIds = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { skipped++; continue; }
    if (!e) { skipped++; continue; }
    const msg = e.message;
    if (e.type === 'assistant' && msg) {
      if (msg.usage) {
        const id = msg.id;
        if (id == null || !seenUsageIds.has(id)) {
          if (id != null) seenUsageIds.add(id);
          events.push({
            kind: 'usage',
            output: msg.usage.output_tokens || 0,
            cacheCreation: msg.usage.cache_creation_input_tokens || 0,
            cacheRead: msg.usage.cache_read_input_tokens || 0,
            // context-size proxy for compaction/pressure detection
            inputTotal: (msg.usage.input_tokens || 0) +
              (msg.usage.cache_read_input_tokens || 0) +
              (msg.usage.cache_creation_input_tokens || 0)
          });
        }
      }
      for (const b of (Array.isArray(msg.content) ? msg.content : [])) {
        if (b && b.type === 'tool_use') {
          events.push({ kind: 'tool_use', id: b.id, name: b.name, input: b.input || {} });
        }
      }
    } else if (e.type === 'user' && msg && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b && b.type === 'tool_result') {
          events.push({
            kind: 'tool_result',
            id: b.tool_use_id,
            isError: b.is_error === true,
            tokens: estTokens(resultText(b.content))
          });
        }
      }
    }
  }
  return { events, skipped };
}

function analyze(events) {
  const useById = new Map();
  const calls = [];
  const totals = { output: 0, cacheCreation: 0, cacheRead: 0 };
  // compaction + context-pressure tracking (event order matters)
  let lastInput = null;
  let compactions = 0;
  const filesRead = new Set();
  let preCompactionFiles = null; // snapshot of filesRead at the latest compaction
  let compactionWasteTokens = 0;
  let compactionReReads = 0;
  const inputWindow = [];
  let peakWindowAvg = 0;
  let peakInput = 0;
  for (const ev of events) {
    if (ev.kind === 'usage') {
      totals.output += ev.output;
      totals.cacheCreation += ev.cacheCreation;
      totals.cacheRead += ev.cacheRead;
      const it = ev.inputTotal || 0;
      if (it > 0) {
        if (lastInput !== null) {
          const drop = lastInput - it;
          if (drop > lastInput * T.compactDropRatio && drop > T.compactDropAbs) {
            compactions++;
            preCompactionFiles = new Set(filesRead);
          }
        }
        lastInput = it;
        inputWindow.push(it);
        if (inputWindow.length > T.pressureWindow) inputWindow.shift();
        const avg = inputWindow.reduce((s, v) => s + v, 0) / inputWindow.length;
        if (avg > peakWindowAvg) peakWindowAvg = avg;
        if (it > peakInput) peakInput = it;
      }
    } else if (ev.kind === 'tool_use') {
      useById.set(ev.id, ev);
    } else if (ev.kind === 'tool_result') {
      const u = useById.get(ev.id);
      calls.push({
        name: u ? u.name : '(unknown)',
        input: u ? u.input : {},
        tokens: ev.tokens,
        isError: ev.isError
      });
      const p = u && u.name === 'Read' && u.input && u.input.file_path;
      if (p) {
        if (preCompactionFiles && preCompactionFiles.has(p)) {
          compactionWasteTokens += ev.tokens;
          compactionReReads++;
        }
        filesRead.add(p);
      }
    }
  }

  const findings = [];

  // file-reread: same file_path Read >= rereadCount times
  const readsByPath = new Map();
  for (const c of calls) {
    const p = c.input && c.input.file_path;
    if (c.name === 'Read' && p) {
      if (!readsByPath.has(p)) readsByPath.set(p, []);
      readsByPath.get(p).push(c);
    }
  }
  for (const [p, arr] of readsByPath) {
    if (arr.length >= T.rereadCount) {
      findings.push({
        category: 'file-reread',
        description: clean(p + ' read ' + arr.length + ' times'),
        estTokens: arr.slice(1).reduce((s, c) => s + c.tokens, 0),
        fix: {
          now: 'Stop the repeat purchases of ' + clean(baseName(p)),
          say: clean('Don\'t re-read ' + baseName(p) + '; reference your earlier read, or read only the changed section with offset/limit.'),
          adopt: 'One read per file per task; re-reads only for changed sections.'
        }
      });
    }
  }

  // giant-read + verbose-output: single oversized tool_result (any tool, not just Read)
  for (const c of calls) {
    if (c.tokens > T.giantRead) {
      const fp = c.input && c.input.file_path;
      const desc = fp || c.name;
      const isArtifact = fp && ARTIFACT_RE.test(fp);
      findings.push({
        category: 'giant-read',
        description: clean(desc + ' returned ~' + c.tokens + ' tokens'),
        estTokens: c.tokens,
        fix: isArtifact ? {
          now: 'Never read ' + clean(baseName(fp)) + ' whole — it is a lockfile/build artifact',
          say: clean('Never read ' + baseName(fp) + ' in full; Grep it for the one entry you need.'),
          adopt: 'Lockfiles and build artifacts are Grep-only.'
        } : {
          now: 'Slice ' + clean(baseName(desc)) + ' instead of swallowing it',
          say: clean('For ' + baseName(desc) + ', Grep for the relevant part first, or read with offset/limit.'),
          adopt: 'Whole-file reads only for files that fit a screen.'
        }
      });
    } else if ((c.name === 'Bash' || c.name === 'PowerShell') && !c.isError && c.tokens > T.verbose) {
      const cmd = clean((c.input && c.input.command) || '').slice(0, 60);
      const flag = quietFlagFor(cmd);
      findings.push({
        category: 'verbose-output',
        description: clean(c.name + ' output ~' + c.tokens + ' tokens'),
        estTokens: c.tokens,
        fix: {
          now: flag ? 'Re-run with ' + flag : 'Trim long output: tail -20 (or Select-Object -Last 20 in PowerShell)',
          say: clean(flag
            ? 'When running "' + cmd + '", use ' + flag + ' and trim long output so it stays small.'
            : 'When running "' + cmd + '", trim it first: tail -20 on macOS/Linux, Select-Object -Last 20 in PowerShell.'),
          adopt: 'Quiet flags by default for test and build commands.'
        }
      });
    }
  }

  // retry-loop: >= retryRun consecutive failing calls of the same tool
  let run = [];
  const endRun = () => {
    if (run.length >= T.retryRun) {
      findings.push({
        category: 'retry-loop',
        description: clean(run[0].name + ' failed ' + run.length + 'x in a row'),
        estTokens: run.reduce((s, c) => s + c.tokens, 0),
        fix: {
          now: 'Interrupt the loop; the approach was wrong at attempt two',
          say: clean('If ' + run[0].name + ' fails twice the same way, stop and diagnose the root cause instead of retrying.'),
          adopt: 'Two-strikes rule: identical failure twice means rethink, not retry.'
        }
      });
    }
    run = [];
  };
  for (const c of calls) {
    if (!c.isError) { endRun(); continue; }
    if (run.length && run[run.length - 1].name !== c.name) endRun();
    run.push(c);
  }
  endRun();

  // cache-churn: heavy cache writes relative to reads
  if (totals.cacheCreation > T.churnMinCreation && totals.cacheCreation > T.churnRatio * totals.cacheRead) {
    findings.push({
      category: 'cache-churn',
      description: clean('Cache writes ~' + totals.cacheCreation + ' tokens vs reads ~' + totals.cacheRead + ' — prompt cache keeps rebuilding'),
      estTokens: totals.cacheCreation,
      fix: {
        now: 'Keep session config stable from here on',
        say: 'Avoid changing MCP servers, plugins, or settings mid-session; each change rebuilds the prompt cache.',
        adopt: 'Configure first, work second; long idle gaps also cold the cache.'
      }
    });
  }

  // compaction-waste: files read before a compaction and re-read after it
  if (compactionWasteTokens > 0) {
    findings.push({
      category: 'compaction-waste',
      description: clean('context compacted ' + compactions + 'x; ' + compactionReReads + ' pre-compaction file read(s) repeated after'),
      estTokens: compactionWasteTokens,
      fix: {
        now: '/clear after finishing each task, before starting the next',
        say: clean('This session compacted ' + compactions + 'x and re-bought ' + compactionReReads + ' file read(s); after each completed task, suggest running /clear before the next one.'),
        adopt: 'Split marathon work across sessions; a fresh session is cheaper than a compacted one.'
      }
    });
  }

  findings.sort((a, b) => b.estTokens - a.estTokens);
  const pressure = peakWindowAvg > T.pressureAvg
    ? { avgInput: Math.round(peakWindowAvg), peakInput }
    : null;

  // Ready-to-paste CLAUDE.md lines: one durable rule per waste class found, so a
  // recurring leak can be killed permanently by project instructions. We never
  // write the user's files — the renderer hands them the block to paste.
  const CLAUDE_MD_LINES = {
    'file-reread': '- Do not re-read files already read this session; reference earlier reads, use offset/limit for changed sections.',
    'giant-read': '- For large files, Grep or read with offset/limit instead of whole-file reads.',
    'giant-read-artifact': '- Never read lockfiles or build artifacts (package-lock.json, dist/, .min.js) whole; Grep them when needed.',
    'verbose-output': '- Run tests and builds with quiet flags; trim long output (tail on macOS/Linux, Select-Object -Last in PowerShell).',
    'retry-loop': '- If a command fails twice identically, stop and diagnose instead of retrying.',
    'cache-churn': '- Keep MCP/plugin/config stable during a session; configure before working.',
    'compaction-waste': '- Split long work across sessions; /clear between tasks to avoid context compaction.'
  };
  const claudeMd = [];
  const seenKeys = new Set();
  for (const f of findings) {
    let key = f.category;
    if (key === 'giant-read' && f.fix && f.fix.adopt && f.fix.adopt.startsWith('Lockfiles')) key = 'giant-read-artifact';
    if (!CLAUDE_MD_LINES[key] || seenKeys.has(key)) continue;
    seenKeys.add(key);
    claudeMd.push(CLAUDE_MD_LINES[key]);
  }
  if (pressure && !seenKeys.has('compaction-waste')) claudeMd.push(CLAUDE_MD_LINES['compaction-waste']);

  return { totals, findings, compactions, pressure, claudeMd };
}

// Upper median of a numeric array; small helper so baselines are selftestable.
function medianOf(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Personal baseline: latest session vs the user's own 30-day median. Needs >=5
// sessions to say anything; never changes verdicts, context only.
function computeBaseline(sessionOutputs) {
  if (sessionOutputs.length < 5) return null;
  const median = medianOf(sessionOutputs);
  if (median <= 0) return null;
  return {
    sessions: sessionOutputs.length,
    medianOutput: median,
    latestVsMedian: +(sessionOutputs[0] / median).toFixed(1)
  };
}

function pickTranscripts(dir, all) {
  let files;
  try {
    files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const full = path.join(dir, f);
        return { full, name: f, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    // TOCTOU: dir or a listed file can vanish between existsSync and here — treat as no transcripts.
    return [];
  }
  if (!all) return files.slice(0, 1);
  const cutoff = Date.now() - 30 * DAY_MS;
  return files.filter(f => f.mtime >= cutoff);
}

function historySummary(out) {
  return {
    findings: out.findings.length,
    wasteTokens: out.findings.reduce((sum, f) => sum + (f.estTokens || 0), 0),
    compactions: out.compactions
  };
}

function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all') || args.includes('all');
  const di = args.indexOf('--project-dir');
  const cwd = di >= 0 && args[di + 1] ? args[di + 1] : process.cwd();
  const dir = path.join(configDir(), 'projects', projectSlug(cwd));
  if (!fs.existsSync(dir)) {
    console.log(JSON.stringify({ error: 'no transcripts found at ' + dir }));
    return;
  }
  const picked = pickTranscripts(dir, all);
  if (picked.length === 0) {
    console.log(JSON.stringify({ error: 'no .jsonl transcripts in ' + dir + (all ? ' within 30 days' : '') }));
    return;
  }
  const out = {
    files: picked.map(f => f.name),
    totals: { output: 0, cacheCreation: 0, cacheRead: 0 },
    findings: [],
    compactions: 0,
    pressure: null,
    baseline: null,
    claudeMd: [],
    skippedLines: 0
  };
  const claudeMdSeen = new Set();
  const sessionOutputs = []; // per-session output totals, newest first (picked is mtime-desc)
  for (const f of picked) {
    let text;
    try { text = fs.readFileSync(f.full, 'utf8'); } catch { out.skippedLines++; continue; }
    const { events, skipped } = parseTranscriptText(text);
    out.skippedLines += skipped;
    const { totals, findings, compactions, pressure, claudeMd } = analyze(events);
    for (const line of claudeMd) {
      if (!claudeMdSeen.has(line)) { claudeMdSeen.add(line); out.claudeMd.push(line); }
    }
    out.totals.output += totals.output;
    out.totals.cacheCreation += totals.cacheCreation;
    out.totals.cacheRead += totals.cacheRead;
    out.findings.push(...findings);
    out.compactions += compactions;
    if (pressure && (!out.pressure || pressure.avgInput > out.pressure.avgInput)) out.pressure = pressure;
    sessionOutputs.push(totals.output);
  }
  if (all) out.baseline = computeBaseline(sessionOutputs);
  out.findings.sort((a, b) => b.estTokens - a.estTokens);
  out.findings = out.findings.slice(0, 10);
  console.log(JSON.stringify(out, null, 2));

  // Append history (silent-fail, never blocks output)
  try {
    const historyLine = JSON.stringify({
      ts: new Date().toISOString(),
      tool: 'waste',
      summary: historySummary(out)
    });
    const historyPath = path.join(configDir(), 'leakhound-history.jsonl');
    let isSymlink = false;
    try { isSymlink = fs.lstatSync(historyPath).isSymbolicLink(); } catch {}
    if (!isSymlink) fs.appendFileSync(historyPath, historyLine + '\n');
  } catch {}
}

function fixtureLines() {
  const L = [];
  const use = (id, name, input) => L.push(JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id, name, input }],
      usage: { output_tokens: 100, cache_creation_input_tokens: 30000, cache_read_input_tokens: 5000 }
    }
  }));
  const res = (id, text, isError) => L.push(JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: !!isError, content: [{ type: 'text', text }] }] }
  }));
  for (let i = 0; i < 3; i++) { use('r' + i, 'Read', { file_path: '/tmp/app.ts' }); res('r' + i, 'x'.repeat(400)); }
  use('g1', 'Read', { file_path: '/tmp/big.json' }); res('g1', 'x'.repeat(100000));
  use('v1', 'Bash', { command: 'npm test' }); res('v1', 'x'.repeat(48000));
  use('gb1', 'Bash', { command: 'dump everything' }); res('gb1', 'x'.repeat(90000));
  use('lk1', 'Read', { file_path: '/proj/package-lock.json' }); res('lk1', 'x'.repeat(90000));
  for (let i = 0; i < 3; i++) { use('f' + i, 'Bash', { command: 'broken' }); res('f' + i, 'err', true); }
  // Same message.id split across two JSONL lines (one per content block, as Claude Code
  // actually writes them) — identical usage on both must be counted once, not twice.
  const dup = JSON.stringify({
    type: 'assistant',
    message: { id: 'dup-1', content: [], usage: { output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }
  });
  L.push(dup);
  L.push(dup);
  L.push('null');
  L.push('not json {{{');
  return L.join('\n');
}

// Separate fixture for compaction/pressure so the main fixture's math stays untouched.
// Timeline: high-context turns (120k, 130k) with a Read of /tmp/a.ts, then a 100k drop
// (>30% and >20k => compaction), then the same file re-read (200 est tokens of waste).
function fixtureCompactionLines() {
  const L = [];
  let n = 0;
  const usage = (inputTokens, cacheRead) => L.push(JSON.stringify({
    type: 'assistant',
    message: {
      id: 'cm' + (n++),
      content: [],
      usage: { output_tokens: 100, input_tokens: inputTokens, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0 }
    }
  }));
  const use = (id, name, input) => L.push(JSON.stringify({
    type: 'assistant', message: { id: 'cm' + (n++), content: [{ type: 'tool_use', id, name, input }] }
  }));
  const res = (id, text) => L.push(JSON.stringify({
    type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: false, content: [{ type: 'text', text }] }] }
  }));
  usage(20000, 100000);                       // inputTotal 120k
  use('c1', 'Read', { file_path: '/tmp/a.ts' });
  res('c1', 'x'.repeat(400));                 // 100 tokens, pre-compaction read
  usage(30000, 100000);                       // 130k
  usage(10000, 20000);                        // 30k -> drop 100k: compaction
  use('c2', 'Read', { file_path: '/tmp/a.ts' });
  res('c2', 'x'.repeat(800));                 // 200 tokens, post-compaction re-read
  return L.join('\n');
}

function selftest() {
  const assert = require('assert');
  const { events, skipped } = parseTranscriptText(fixtureLines());
  assert.equal(skipped, 2, 'malformed line and literal null line should both be skipped');
  const { totals, findings, compactions, pressure } = analyze(events);
  assert.equal(compactions, 0, 'flat 35k context fixture has no compactions');
  assert.equal(pressure, null, '35k avg context is below the 50k pressure line');
  assert.equal(totals.output, 1500, 'output tokens: 10 id-less usage entries x100 + one deduped-by-id entry of 500');
  const cats = findings.map(f => f.category);
  for (const c of ['file-reread', 'giant-read', 'verbose-output', 'retry-loop', 'cache-churn']) {
    assert(cats.includes(c), 'missing category ' + c);
  }
  const rr = findings.find(f => f.category === 'file-reread');
  assert.equal(rr.estTokens, 200, 'reread cost = repeats after first (2 x 100 est tokens)');
  const giants = findings.filter(f => f.category === 'giant-read');
  assert.equal(giants.length, 3, 'any tool over threshold flags giant-read, not just Read');
  assert(giants.some(f => f.description.startsWith('/tmp/big.json')), 'giant-read uses file_path when present');
  assert(giants.some(f => f.description.startsWith('Bash')), 'giant-read falls back to tool name without file_path');

  // structured fixes: data-specific, copy-pasteable
  assert.equal(rr.fix.say.includes('app.ts'), true, 'file-reread fix names the actual file');
  const lockGiant = giants.find(f => f.description.includes('package-lock'));
  assert(lockGiant.fix.say.startsWith('Never read package-lock.json'), 'artifact giant-read gets the Grep-only fix');
  assert(lockGiant.fix.adopt.startsWith('Lockfiles'), 'artifact adopt line');
  const vb = findings.find(f => f.category === 'verbose-output');
  assert(vb.fix.say.includes('--reporter=dot'), 'npm test verbose fix names the exact quiet flag');
  assert.equal(quietFlagFor('pytest -x tests/'), '-q', 'quiet-flag table covers pytest');
  assert.equal(quietFlagFor('some-unknown-tool go'), null, 'unknown commands get no flag');
  const verboseCount = findings.filter(f => f.category === 'verbose-output').length;
  assert.equal(verboseCount, 1, 'a giant-read result must not also double-report as verbose-output');
  for (let i = 1; i < findings.length; i++) {
    assert(findings[i - 1].estTokens >= findings[i].estTokens, 'findings sorted desc by estTokens');
  }

  // clean(): a hostile 500-char path with an embedded newline must not blow up a
  // rendered description or break the diff-fenced output with a stray line break.
  const dirtyPath = 'x'.repeat(500) + '\n' + 'y'.repeat(50);
  const desc = clean(dirtyPath + ' read 3 times');
  assert(desc.length <= 200, 'clean() caps description length at 200');
  assert(!desc.includes('\n'), 'clean() strips embedded newlines');

  // claudeMd block: one durable line per waste class found, artifact variant included
  const cm = analyze(events).claudeMd;
  assert(cm.some(l => l.includes('lockfiles or build artifacts')), 'claudeMd carries the artifact rule');
  assert(cm.some(l => l.includes('re-read files already read')), 'claudeMd carries the re-read rule');
  assert.equal(new Set(cm).size, cm.length, 'claudeMd lines are deduped');

  // compaction + pressure fixture
  const comp = analyze(parseTranscriptText(fixtureCompactionLines()).events);
  assert.equal(comp.compactions, 1, '100k drop from 130k is a compaction');
  assert(comp.pressure && comp.pressure.avgInput > 50000, 'high-context turns trip the pressure signal');
  assert.equal(comp.pressure.peakInput, 130000, 'peak context recorded');
  const cw = comp.findings.find(f => f.category === 'compaction-waste');
  assert(cw, 'post-compaction re-read produces a compaction-waste finding');
  assert.equal(cw.estTokens, 200, 'only the post-compaction re-read tokens are attributed');
  assert(cw.description.includes('1x'), 'description carries the compaction count');

  // history summary: what a waste run appends to leakhound-history.jsonl
  const hs = historySummary({
    findings: [{ estTokens: 6000 }, { estTokens: 500 }, {}],
    compactions: 2
  });
  assert.equal(hs.findings, 3, 'history counts findings');
  assert.equal(hs.wasteTokens, 6500, 'history sums estTokens, missing treated as 0');
  assert.equal(hs.compactions, 2, 'history carries compaction count');

  // baselines
  assert.equal(medianOf([5, 1, 3]), 3, 'medianOf odd');
  assert.equal(medianOf([4, 1, 2, 3]), 3, 'medianOf even takes the upper median');
  assert.equal(computeBaseline([1, 2, 3, 4]), null, 'fewer than 5 sessions -> no baseline');
  const b = computeBaseline([9000, 3000, 4000, 3000, 2000]);
  assert.equal(b.medianOutput, 3000, 'median of the 5 sessions');
  assert.equal(b.latestVsMedian, 3, 'latest (first, newest) vs median');
  assert.equal(computeBaseline([0, 0, 0, 0, 0]), null, 'zero median -> no baseline');

  console.log('selftest OK');
}

if (process.argv.includes('--selftest')) selftest();
else main();
