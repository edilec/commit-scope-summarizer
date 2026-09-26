import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const bin = resolve('bin/commit-scope-summarizer.mjs');
const guard = resolve('support/deny-network.mjs');
const run = (...args) => spawnSync(process.execPath, ['--import', guard, bin, ...args], { encoding: 'utf8' });
const example = name => resolve('examples', name);

test('saved history examples exercise pass, review-fail and incomplete CLI exits', () => {
  for (const [name, exit, status] of [['clean', 0, 'pass'], ['failing', 1, 'fail'], ['incomplete', 2, 'incomplete']]) {
    const child = run('--root', example(name), '--input', 'input.json');
    assert.equal(child.status, exit, child.stderr);
    const report = JSON.parse(child.stdout);
    assert.equal(report.status, status);
    assert.equal(report.tool, 'commit-scope-summarizer');
    assert.match(child.stderr, /^(?:pass|fail|incomplete): \d+ commits, \d+ review candidates, \d+ warnings\n$/u);
    assert.equal(child.stdout.includes('synthetic view'), false);
  }
});

test('help, JSON-only mode and invalid configuration use distinct stdout shapes', () => {
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--root DIR --input FILE/u);
  assert.equal(help.stderr, '');
  const json = run('--root', example('clean'), '--input', 'input.json', '--json');
  assert.equal(json.status, 0);
  assert.equal(json.stderr, '');
  const bad = run('--root', example('clean'), '--input', 'input.json', '--json', '--bad=SYNTHETIC_SECRET_CANARY');
  assert.equal(bad.status, 2);
  assert.equal(bad.stdout, '');
  assert.equal(bad.stderr, 'Invalid CLI configuration.\n');
  const rootFile = run('--root', resolve('package.json'), '--input', 'input.json');
  assert.equal(rootFile.status, 2);
  assert.equal(rootFile.stdout, '');
});

test('missing and malformed named exports are incomplete reports with no raw diagnostic text', () => {
  const root = mkdtempSync(join(tmpdir(), 'commit-scope-input-'));
  try {
    const missing = run('--root', root, '--input', 'input.json');
    assert.equal(missing.status, 2);
    assert.deepEqual(JSON.parse(missing.stdout).findings.map(f => f.ruleId), ['input-unreadable']);
    writeFileSync(join(root, 'input.json'), '{"subject": token=SYNTHETIC_SECRET_CANARY}');
    const malformed = run('--root', root, '--input', 'input.json');
    assert.equal(malformed.status, 2);
    assert.equal(JSON.parse(malformed.stdout).status, 'incomplete');
    assert.deepEqual(JSON.parse(malformed.stdout).findings.map(f => f.ruleId), ['input-invalid']);
    assert.equal((malformed.stdout + malformed.stderr).includes('SYNTHETIC_SECRET_CANARY'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an input basename is a locator, not report evidence, even when the named export is invalid', () => {
  const root = mkdtempSync(join(tmpdir(), 'commit-scope-private-name-'));
  const name = 'token-SYNTHETIC_SECRET_CANARY.json';
  try {
    const badSubject = {
      schemaVersion: '1', packageRoots: [], commits: [
        { id: 'a'.repeat(40), subject: 'unsupported synthetic subject', files: ['README.md'], reverts: null },
      ],
    };
    writeFileSync(join(root, name), JSON.stringify(badSubject));
    const invalid = run('--root', root, '--input', name);
    assert.equal(invalid.status, 2);
    assert.deepEqual(JSON.parse(invalid.stdout).findings.map(f => f.ruleId), ['subject-unsupported']);
    assert.deepEqual(JSON.parse(invalid.stdout).findings.map(f => f.location.file), ['input']);
    assert.equal((invalid.stdout + invalid.stderr).includes('SYNTHETIC_SECRET_CANARY'), false);

    writeFileSync(join(root, name), '{broken JSON');
    const malformed = run('--root', root, '--input', name);
    assert.equal(malformed.status, 2);
    assert.deepEqual(JSON.parse(malformed.stdout).findings.map(f => f.ruleId), ['input-invalid']);
    assert.deepEqual(JSON.parse(malformed.stdout).findings.map(f => f.location.file), ['input']);
    assert.equal((malformed.stdout + malformed.stderr).includes('SYNTHETIC_SECRET_CANARY'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a named symlink cannot import history evidence outside the real root', () => {
  const root = mkdtempSync(join(tmpdir(), 'commit-scope-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'commit-scope-outside-'));
  try {
    writeFileSync(join(outside, 'secret.json'), '{"note":"SYNTHETIC_SECRET_CANARY"}');
    symlinkSync(join(outside, 'secret.json'), join(root, 'input.json'));
    const child = run('--root', root, '--input', 'input.json');
    assert.equal(child.status, 2);
    assert.deepEqual(JSON.parse(child.stdout).findings.map(f => f.ruleId), ['path-outside-root']);
    assert.equal(child.stdout.includes('SYNTHETIC_SECRET_CANARY'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('input byte limit allows exactly 1048576 bytes and refuses the next byte', () => {
  const root = mkdtempSync(join(tmpdir(), 'commit-scope-bytes-'));
  try {
    const text = JSON.stringify({ schemaVersion: '1', packageRoots: [], commits: [{ id: 'a'.repeat(40), subject: 'docs(ui): synthetic note', files: ['README.md'], reverts: null }] });
    const input = join(root, 'input.json');
    writeFileSync(input, text + ' '.repeat(1048576 - Buffer.byteLength(text)));
    const at = run('--root', root, '--input', 'input.json');
    assert.equal(at.status, 0, at.stderr);
    assert.equal(JSON.parse(at.stdout).status, 'pass');
    writeFileSync(input, text + ' '.repeat(1048577 - Buffer.byteLength(text)));
    const over = run('--root', root, '--input', 'input.json');
    assert.equal(over.status, 2);
    assert.deepEqual(JSON.parse(over.stdout).findings.map(f => f.location.pointer), ['/limits/maxBytes']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('two identical saved exports produce byte-identical JSON stdout', () => {
  const first = run('--root', example('clean'), '--input', 'input.json');
  const second = run('--root', example('clean'), '--input', 'input.json');
  assert.equal(first.status, 0);
  assert.equal(first.stdout, second.stdout);
});

test('filesystem root is a valid enclosing root for a clean absolute fixture path', () => {
  const absolute = resolve('examples/clean/input.json');
  const child = run('--root', '/', '--input', absolute.slice(1), '--json');
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).status, 'pass');
  assert.equal(child.stderr, '');
});
