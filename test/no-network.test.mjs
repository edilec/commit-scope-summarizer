import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const guard = resolve('support/deny-network.mjs');

test('active denial guard rejects a data URL fetch and a null socket connect', () => {
  for (const expression of [
    "await fetch('data:text/plain,probe')",
    "(await import('node:net')).Socket.prototype.connect.call(null)",
  ]) {
    const child = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '-e', expression], { encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /network forbidden by test guard/u);
  }
});

test('product source has no network, subprocess or command execution entry point', () => {
  const forbidden = /(?:\bfetch\s*\(|\.(?:listen|connect|request|lookup|resolve)\s*\(|(?<!\.)\b(?:spawn|exec|fork)\s*\(|(?:from|import\s*\()\s*['"]node:(?:net|dns|http|https|child_process)['"])/u;
  for (const path of ['src/index.mjs', 'src/json.mjs', 'bin/commit-scope-summarizer.mjs']) {
    assert.doesNotMatch(readFileSync(resolve(path), 'utf8'), forbidden, path);
  }
  assert.match('server.listen(0)', forbidden);
});
