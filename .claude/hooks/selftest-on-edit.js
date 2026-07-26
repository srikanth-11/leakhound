#!/usr/bin/env node
/* Runs the touched leakhound script's --selftest after every Edit/Write.
   Pass: silent. Fail: exit 2 so Claude sees the failure and fixes it. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function main() {
  let input = '';
  try { input = fs.readFileSync(0, 'utf8'); } catch { return; }
  let fp = '';
  try { fp = (JSON.parse(input).tool_input || {}).file_path || ''; } catch { return; }
  if (!fp || !fp.endsWith('.js')) return;
  const norm = fp.replace(/\\/g, '/');
  if (!/\/(scripts|router\/scripts)\/[^/]+\.js$/.test(norm)) return;
  if (!fs.existsSync(fp)) return;
  try {
    execFileSync(process.execPath, [fp, '--selftest'], { timeout: 20000, encoding: 'utf8' });
  } catch (e) {
    const out = ((e.stdout || '') + '\n' + (e.stderr || e.message || '')).trim().slice(-800);
    process.stderr.write('leakhound selftest FAILED for ' + path.basename(fp) + ':\n' + out);
    process.exit(2);
  }
}

try { main(); } catch {}
