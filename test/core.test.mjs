import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeHistory, isSafePath, ConfigError } from '../src/index.mjs';

const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const c = 'c'.repeat(40);
const clean = () => ({
  schemaVersion: '1',
  packageRoots: ['packages/app', 'packages/lib'],
  commits: [{ id: a, subject: 'docs(ui): clarify synthetic guide', files: ['packages/app/README.md'], reverts: null }],
});

test('a complete noncandidate history passes with exact ordinal provenance and no raw labels', () => {
  const report = summarizeHistory(clean(), { now: () => 0 });
  assert.equal(report.tool, 'commit-scope-summarizer');
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.summary, { checked: 1, errors: 0, warnings: 0, commits: 1, packages: 2, features: 1, candidates: 0, reverts: 0 });
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.packageGroups.map(g => [g.ordinal, g.sourcePointer, g.commitOrdinals]), [
    [1, '/packageRoots/0', [1]], [2, '/packageRoots/1', []],
  ]);
  assert.deepEqual(report.featureGroups.map(g => [g.ordinal, g.sourcePointer, g.commitOrdinals]), [
    [1, '/commits/0/subject', [1]],
  ]);
  assert.equal(report.commits[0].releaseNote, 'none');
  const output = JSON.stringify(report);
  for (const text of [a, 'clarify synthetic guide', 'packages/app', 'README.md', 'author']) {
    assert.equal(output.includes(text), false, text);
  }
});

test('an active feature becomes a located release-note review flag, not a missing-note claim', () => {
  const document = clean();
  document.commits[0].subject = 'feat(ui): add synthetic view';
  const report = summarizeHistory(document, { now: () => 0 });
  assert.equal(report.status, 'fail');
  assert.equal(report.summary.candidates, 1);
  assert.deepEqual(report.findings.map(f => [f.ruleId, f.severity, f.location.pointer]), [
    ['release-note-review', 'error', '/commits/0/subject'],
  ]);
  assert.equal(report.findings[0].message.includes('missing'), false);
  assert.deepEqual(report.releaseNotes.map(n => [n.commitOrdinal, n.kind, n.sourcePointer]), [
    [1, 'feature', '/commits/0/subject'],
  ]);
  assert.equal(JSON.stringify(report).includes('add synthetic view'), false);
});

test('an explicit supported revert links its target and clears the active candidate', () => {
  const document = clean();
  document.commits = [
    { id: a, subject: 'feat(ui): add synthetic view', files: ['packages/app/src/view.js'], reverts: null },
    { id: b, subject: 'revert(ui): undo synthetic view', files: ['packages/app/src/view.js'], reverts: a },
  ];
  const report = summarizeHistory(document, { now: () => 0 });
  assert.equal(report.status, 'pass');
  assert.equal(report.summary.checked, 2);
  assert.equal(report.summary.reverts, 1);
  assert.equal(report.summary.candidates, 0);
  assert.deepEqual(report.releaseNotes, []);
  assert.deepEqual(report.relationships.map(r => [r.revertOrdinal, r.targetOrdinal, r.sourcePointer]), [
    [2, 1, '/commits/1/reverts'],
  ]);
  assert.equal(report.commits[0].releaseNote, 'reverted');
  assert.equal(report.commits[0].revertedByOrdinal, 2);
  assert.equal(JSON.stringify(report).includes(a), false);
});

test('an unresolved revert is incomplete rather than treating its target as absent', () => {
  const document = clean();
  document.commits.push({ id: b, subject: 'revert(ui): undo unknown change', files: ['packages/app/src/view.js'], reverts: c });
  const report = summarizeHistory(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.ruleId === 'revert-unresolved' && f.location.pointer === '/commits/1/reverts'));
  assert.equal(JSON.stringify(report).includes(c), false);
});

test('a commit beyond the analysis cap may revert a visible feature, so no active candidate is asserted', () => {
  const exact = clean();
  exact.commits[0].subject = 'feat(ui): add synthetic view';
  const atBound = summarizeHistory(exact, { now: () => 0, limits: { maxCommits: 1 } });
  assert.equal(atBound.status, 'fail');
  assert.equal(atBound.summary.candidates, 1);

  const document = clean();
  document.commits = [
    { id: a, subject: 'feat(ui): add synthetic view', files: ['packages/app/src/view.js'], reverts: null },
    { id: b, subject: 'revert(ui): undo synthetic view', files: ['packages/app/src/view.js'], reverts: a },
  ];
  const complete = summarizeHistory(document, { now: () => 0 });
  assert.equal(complete.status, 'pass');
  assert.equal(complete.summary.candidates, 0);
  assert.equal(complete.commits[0].releaseNote, 'reverted');

  const limited = summarizeHistory(document, { now: () => 0, limits: { maxCommits: 1 } });
  assert.equal(limited.status, 'incomplete');
  assert.equal(limited.summary.commits, 2);
  assert.equal(limited.summary.checked, 1);
  assert.equal(limited.commits[0].releaseNote, 'unknown');
  assert.deepEqual(limited.releaseNotes, []);
  assert.equal(limited.findings.some(f => f.ruleId === 'release-note-review'), false);
  assert.equal(limited.findings.some(f => f.ruleId === 'limit-exceeded' && f.location.pointer === '/limits/maxCommits'), true);
});

test('a revert of a revert is located as incomplete without guessing net release state', () => {
  const document = clean();
  document.commits = [
    { id: a, subject: 'feat(ui): add synthetic view', files: ['packages/app/src/view.js'], reverts: null },
    { id: b, subject: 'revert(ui): undo synthetic view', files: ['packages/app/src/view.js'], reverts: a },
    { id: c, subject: 'revert(ui): undo previous revert', files: ['packages/app/src/view.js'], reverts: b },
  ];
  const report = summarizeHistory(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.ruleId === 'revert-ambiguous' && f.location.pointer === '/commits/2/reverts'));
  assert.equal(report.commits[0].releaseNote, 'uncertain');
  assert.deepEqual(report.releaseNotes, []);
});

test('reverse chronological export order does not make a revert-of-revert target look settled', () => {
  const document = clean();
  document.commits = [
    { id: c, subject: 'revert(ui): undo previous revert', files: ['packages/app/src/view.js'], reverts: b },
    { id: b, subject: 'revert(ui): undo synthetic view', files: ['packages/app/src/view.js'], reverts: a },
    { id: a, subject: 'feat(ui): add synthetic view', files: ['packages/app/src/view.js'], reverts: null },
  ];
  const report = summarizeHistory(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.commits[2].releaseNote, 'uncertain');
  assert.deepEqual(report.releaseNotes, []);
  assert.deepEqual(report.relationships.map(r => [r.revertOrdinal, r.targetOrdinal]), [[1, 2], [2, 3]]);
});

test('duplicate IDs and unsupported metadata never create a clean classification', () => {
  const duplicate = clean();
  duplicate.commits.push({ id: a, subject: 'docs(ui): second synthetic note', files: ['packages/app/next.md'], reverts: null });
  const report = summarizeHistory(duplicate, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.ruleId === 'commit-duplicate' && f.location.pointer === '/commits/1/id'));
  const unsupported = clean();
  unsupported.commits[0].author = 'SYNTHETIC_AUTHOR_CANARY';
  const extra = summarizeHistory(unsupported, { now: () => 0 });
  assert.equal(extra.status, 'incomplete');
  assert.equal(JSON.stringify(extra).includes('SYNTHETIC_AUTHOR_CANARY'), false);
});

test('an ambiguous revert target cannot leave either duplicate identity as an active candidate', () => {
  const document = clean();
  document.commits = [
    { id: a, subject: 'feat(ui): first synthetic view', files: ['packages/app/src/first.js'], reverts: null },
    { id: a, subject: 'feat(ui): second synthetic view', files: ['packages/app/src/second.js'], reverts: null },
    { id: b, subject: 'revert(ui): undo synthetic view', files: ['packages/app/src/first.js'], reverts: a },
  ];
  const ambiguous = summarizeHistory(document, { now: () => 0 });
  assert.equal(ambiguous.status, 'incomplete');
  assert.equal(ambiguous.findings.some(f => f.ruleId === 'commit-duplicate'), true);
  assert.equal(ambiguous.findings.some(f => f.ruleId === 'revert-ambiguous'), true);
  assert.deepEqual(ambiguous.commits.slice(0, 2).map(row => row.releaseNote), ['uncertain', 'uncertain']);
  assert.deepEqual(ambiguous.releaseNotes, []);
  assert.equal(ambiguous.findings.some(f => f.ruleId === 'release-note-review'), false);

  document.commits[1].id = c;
  const unique = summarizeHistory(document, { now: () => 0 });
  assert.equal(unique.status, 'fail');
  assert.equal(unique.commits[0].releaseNote, 'reverted');
  assert.equal(unique.commits[1].releaseNote, 'candidate');
  assert.equal(unique.summary.candidates, 1);
});

test('a duplicate commit identity is not two independently active release-note candidates', () => {
  const document = clean();
  document.commits = [
    { id: a, subject: 'feat(ui): first synthetic view', files: ['packages/app/src/first.js'], reverts: null },
    { id: b, subject: 'feat(ui): second synthetic view', files: ['packages/app/src/second.js'], reverts: null },
  ];
  const unique = summarizeHistory(document, { now: () => 0 });
  assert.equal(unique.status, 'fail');
  assert.equal(unique.summary.candidates, 2);
  assert.deepEqual(unique.commits.map(row => row.releaseNote), ['candidate', 'candidate']);

  document.commits[1].id = a;
  const duplicate = summarizeHistory(document, { now: () => 0 });
  assert.equal(duplicate.status, 'incomplete');
  assert.equal(duplicate.findings.some(f => f.ruleId === 'commit-duplicate'), true);
  assert.deepEqual(duplicate.commits.map(row => row.releaseNote), ['uncertain', 'uncertain']);
  assert.equal(duplicate.summary.candidates, 0);
  assert.deepEqual(duplicate.releaseNotes, []);
  assert.equal(duplicate.findings.some(f => f.ruleId === 'release-note-review'), false);
});

test('a revert without a usable target makes visible release-note activity unknown', () => {
  const document = clean();
  document.commits = [
    { id: a, subject: 'feat(ui): add synthetic view', files: ['packages/app/src/view.js'], reverts: null },
    { id: b, subject: 'revert(ui): undo a synthetic view', files: ['packages/app/src/view.js'], reverts: null },
  ];
  const missing = summarizeHistory(document, { now: () => 0 });
  assert.equal(missing.status, 'incomplete');
  assert.equal(missing.findings.some(f => f.ruleId === 'revert-unresolved' && f.location.pointer === '/commits/1/reverts'), true);
  assert.equal(missing.commits[0].releaseNote, 'unknown');
  assert.deepEqual(missing.releaseNotes, []);
  assert.equal(missing.findings.some(f => f.ruleId === 'release-note-review'), false);

  document.commits[1].reverts = a;
  const known = summarizeHistory(document, { now: () => 0 });
  assert.equal(known.status, 'pass');
  assert.equal(known.commits[0].releaseNote, 'reverted');
  assert.equal(known.summary.candidates, 0);
});

test('an unclassified or contradictory commit may hide a revert, so active release state is unknown', () => {
  const document = clean();
  document.commits = [
    { id: a, subject: 'feat(ui): add synthetic view', files: ['packages/app/src/view.js'], reverts: null },
    { id: b, subject: 'docs(ui): describe synthetic view', files: ['packages/app/README.md'], reverts: null },
  ];
  const known = summarizeHistory(document, { now: () => 0 });
  assert.equal(known.status, 'fail');
  assert.equal(known.summary.candidates, 1);

  for (const reverts of [a, null]) {
    document.commits[1].subject = 'revert: undo synthetic view';
    document.commits[1].reverts = reverts;
    const unknown = summarizeHistory(document, { now: () => 0 });
    assert.equal(unknown.status, 'incomplete');
    assert.equal(unknown.findings.some(f => f.ruleId === 'subject-unsupported'), true);
    assert.equal(unknown.commits[0].releaseNote, 'unknown');
    assert.deepEqual(unknown.releaseNotes, []);
    assert.equal(unknown.findings.some(f => f.ruleId === 'release-note-review'), false);
  }

  document.commits[1].subject = 'docs(ui): describe synthetic view';
  document.commits[1].reverts = a;
  const contradictory = summarizeHistory(document, { now: () => 0 });
  assert.equal(contradictory.status, 'incomplete');
  assert.equal(contradictory.commits[0].releaseNote, 'unknown');
  assert.deepEqual(contradictory.releaseNotes, []);
});

test('nested package roots choose the deepest owner and preserve an explicit root group', () => {
  const document = clean();
  document.packageRoots = ['packages/z', 'packages/z/child', 'packages/A'];
  document.commits[0].files = ['packages/z/child/src/file.js', 'README.md'];
  const report = summarizeHistory(document, { now: () => 0 });
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.packageGroups.map(g => [g.ordinal, g.sourcePointer, g.commitOrdinals]), [
    [0, '/packageRoots', [1]], [1, '/packageRoots/2', []], [2, '/packageRoots/0', []], [3, '/packageRoots/1', [1]],
  ]);
  assert.deepEqual(report.commits[0].packageOrdinals, [0, 3]);
});

test('a dropped package root cannot turn its files into known unmatched files', () => {
  const document = clean();
  document.commits[0].files = ['packages/app/src/view.js'];
  const known = summarizeHistory(document, { now: () => 0 });
  assert.equal(known.status, 'pass');
  assert.deepEqual(known.commits[0].packageOrdinals, [1]);
  assert.equal(known.summary.checked, 1);

  document.packageRoots[0] = 'packages/app/';
  const unknown = summarizeHistory(document, { now: () => 0 });
  assert.equal(unknown.status, 'incomplete');
  assert.equal(unknown.findings.some(f => f.ruleId === 'package-invalid' && f.location.pointer === '/packageRoots/0'), true);
  assert.equal(unknown.commits[0].packageOrdinals, null);
  assert.equal(unknown.summary.checked, 0);
  assert.equal(unknown.packageGroups.some(group => group.ordinal === 0), false);
});

test('feature ordinals sort by UTF-16 code unit without echoing scope names', () => {
  const document = clean();
  document.commits = [
    { id: a, subject: 'docs(a): synthetic lower', files: ['packages/app/a.md'], reverts: null },
    { id: b, subject: 'docs(Z): synthetic upper', files: ['packages/app/z.md'], reverts: null },
  ];
  const report = summarizeHistory(document, { now: () => 0 });
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.featureGroups.map(g => [g.ordinal, g.sourcePointer, g.commitOrdinals]), [
    [1, '/commits/1/subject', [2]], [2, '/commits/0/subject', [1]],
  ]);
  assert.equal(JSON.stringify(report).includes('synthetic lower'), false);
});

test('empty history, unsafe files and wholly invisible subjects never pass', () => {
  const empty = summarizeHistory({ ...clean(), commits: [] }, { now: () => 0 });
  assert.equal(empty.status, 'incomplete');
  assert.equal(empty.summary.checked, 0);
  const unsafe = clean();
  unsafe.commits[0].files = ['packages/app/token=SYNTHETIC_SECRET_CANARY'];
  const pathReport = summarizeHistory(unsafe, { now: () => 0 });
  assert.equal(pathReport.status, 'incomplete');
  assert.ok(pathReport.findings.some(f => f.ruleId === 'path-invalid' && f.location.pointer === '/commits/0/files/0'));
  assert.equal(JSON.stringify(pathReport).includes('SYNTHETIC_SECRET_CANARY'), false);
  const invisible = clean();
  invisible.commits[0].subject = 'docs(ui): ' + String.fromCharCode(0x034f);
  const subjectReport = summarizeHistory(invisible, { now: () => 0 });
  assert.equal(subjectReport.status, 'incomplete');
  assert.ok(subjectReport.findings.some(f => f.ruleId === 'subject-unsupported'));
});

test('a shell-looking subject is inert data and never appears in output', () => {
  const document = clean();
  document.commits[0].subject = 'docs(ui): $(touch SYNTHETIC_COMMAND_CANARY)';
  const report = summarizeHistory(document, { now: () => 0 });
  assert.equal(report.status, 'pass');
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_COMMAND_CANARY'), false);
});

test('commit and file bounds accept N and refuse N plus one', () => {
  const document = clean();
  document.commits = Array.from({ length: 128 }, (_, index) => ({ ...clean().commits[0], id: index.toString(16).padStart(40, '0') }));
  assert.equal(summarizeHistory(document, { now: () => 0 }).status, 'pass');
  document.commits.push({ ...clean().commits[0], id: 'f'.repeat(40) });
  let report = summarizeHistory(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.location.pointer === '/limits/maxCommits'));
  const files = clean();
  files.commits[0].files = ['packages/app/a', 'packages/app/b'];
  assert.equal(summarizeHistory(files, { now: () => 0, limits: { maxFiles: 2 } }).status, 'pass');
  files.commits[0].files.push('packages/app/c');
  report = summarizeHistory(files, { now: () => 0, limits: { maxFiles: 2 } });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.location.pointer === '/limits/maxFiles'));
});

test('package-root, subject and safe-path unit bounds accept N and refuse N plus one', () => {
  const roots = clean();
  roots.packageRoots = ['packages/app'];
  assert.equal(summarizeHistory(roots, { now: () => 0, limits: { maxPackageRoots: 1 } }).status, 'pass');
  roots.packageRoots.push('packages/lib');
  const tooManyRoots = summarizeHistory(roots, { now: () => 0, limits: { maxPackageRoots: 1 } });
  assert.equal(tooManyRoots.status, 'incomplete');
  assert.ok(tooManyRoots.findings.some(f => f.location.pointer === '/limits/maxPackageRoots'));

  const subject = clean();
  const exact = subject.commits[0].subject.length;
  assert.equal(summarizeHistory(subject, { now: () => 0, limits: { maxSubjectUnits: exact } }).status, 'pass');
  subject.commits[0].subject += 'X';
  const tooLong = summarizeHistory(subject, { now: () => 0, limits: { maxSubjectUnits: exact } });
  assert.equal(tooLong.status, 'incomplete');
  assert.ok(tooLong.findings.some(f => f.location.pointer === '/limits/maxSubjectUnits'));

  assert.equal(isSafePath('a'.repeat(256)), true);
  assert.equal(isSafePath('a'.repeat(257)), false);
});

test('injected clock allows exact deadline but refuses elapsed N plus one and backward time', () => {
  const clock = end => { let calls = 0; return () => calls++ === 0 ? 0 : end; };
  assert.equal(summarizeHistory(clean(), { now: clock(1), limits: { timeoutMs: 1 } }).status, 'pass');
  const late = summarizeHistory(clean(), { now: clock(2), limits: { timeoutMs: 1 } });
  assert.equal(late.status, 'incomplete');
  assert.ok(late.findings.some(f => f.location.pointer === '/limits/timeoutMs'));
  assert.equal(summarizeHistory(clean(), { now: () => NaN }).status, 'incomplete');
  const backward = (() => { let calls = 0; return () => calls++ === 0 ? 1 : 0; })();
  assert.equal(summarizeHistory(clean(), { now: backward }).status, 'incomplete');
});

test('only own declared analysis limit names are accepted', () => {
  assert.equal(summarizeHistory(clean(), { now: () => 0, limits: { maxCommits: 1 } }).status, 'pass');
  for (const key of ['toString', 'constructor', '__proto__']) {
    const limits = JSON.parse(`{"${key}":1}`);
    assert.throws(() => summarizeHistory(clean(), { now: () => 0, limits }), ConfigError, key);
  }
});

test('the in-memory API refuses a byte limit it cannot measure from an original export', () => {
  const document = clean();
  const encodedBytes = Buffer.byteLength(JSON.stringify(document));
  assert.equal(summarizeHistory(document, { now: () => 0 }).status, 'pass');
  assert.throws(() => summarizeHistory(document, { now: () => 0, limits: { maxBytes: encodedBytes } }), ConfigError);
  assert.throws(() => summarizeHistory(document, { now: () => 0, limits: { maxBytes: encodedBytes - 1 } }), ConfigError);
});
