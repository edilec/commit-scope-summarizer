#!/usr/bin/env node
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { summarizeHistory, incompleteInput, isSafePath, DEFAULT_LIMITS } from '../src/index.mjs';
import { parseStrictJson } from '../src/json.mjs';

const usage = 'Usage: commit-scope-summarizer --root DIR --input FILE [--json]\n';
const inside = (path, root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json' && !Object.hasOwn(options, 'json')) options.json = true;
    else if (['--root', '--input'].includes(arg) && !Object.hasOwn(options, arg.slice(2)) && i + 1 < args.length) {
      options[arg.slice(2)] = args[++i];
    } else throw Error('Invalid CLI configuration.');
  }
  if (typeof options.root !== 'string' || !options.root || !isSafePath(options.input)) {
    throw Error('Invalid CLI configuration.');
  }
  let realRoot;
  try { realRoot = realpathSync(resolve(options.root)); if (!statSync(realRoot).isDirectory()) throw Error(); }
  catch { throw Error('Invalid CLI configuration.'); }
  return { ...options, realRoot };
}

function reportFor(options) {
  const file = options.input;
  const named = resolve(options.realRoot, file);
  let real;
  try { real = realpathSync(named); }
  catch { return incompleteInput(file, 'input-unreadable'); }
  if (!inside(real, options.realRoot)) return incompleteInput(file, 'path-outside-root');
  if (real !== named) return incompleteInput(file, 'input-alias-unsupported');
  let bytes;
  try {
    const stats = statSync(real);
    if (!stats.isFile()) return incompleteInput(file, 'input-unreadable');
    if (stats.size > DEFAULT_LIMITS.maxBytes) return incompleteInput(file, 'limit-exceeded', '/limits/maxBytes');
    bytes = readFileSync(real);
  } catch { return incompleteInput(file, 'input-unreadable'); }
  if (bytes.length > DEFAULT_LIMITS.maxBytes) return incompleteInput(file, 'limit-exceeded', '/limits/maxBytes');
  let document;
  try { document = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return incompleteInput(file, 'input-invalid'); }
  return summarizeHistory(document, { file });
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) process.stdout.write(usage);
  else {
    const report = reportFor(options);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (!options.json) process.stderr.write(`${report.status}: ${report.summary.commits} commits, ${report.summary.candidates} review candidates, ${report.summary.warnings} warnings\n`);
    process.exitCode = report.status === 'pass' ? 0 : report.status === 'fail' ? 1 : 2;
  }
} catch {
  process.stderr.write('Invalid CLI configuration.\n');
  process.exitCode = 2;
}
