#!/usr/bin/env node
/* Non-blocking reminder when a plugin manifest is edited: bump the version
   or installers silently keep the old cached copy (same-version updates skip
   the copy step — learned the hard way). */
'use strict';
const fs = require('fs');

try {
  let fp = '';
  try { fp = (JSON.parse(fs.readFileSync(0, 'utf8')).tool_input || {}).file_path || ''; } catch {}
  const norm = fp.replace(/\\/g, '/');
  if (norm.includes('.claude-plugin/') && norm.endsWith('plugin.json')) {
    console.log(JSON.stringify({
      systemMessage: 'leakhound: editing a plugin manifest — remember to bump "version", or installers keep the old cached copy (same-version updates skip the cache refresh).'
    }));
  }
} catch {}
