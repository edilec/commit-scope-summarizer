export const TOOL_ID = 'commit-scope-summarizer';
export class ConfigError extends Error {}
export const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 1048576, maxCommits: 128, maxPackageRoots: 64, maxFiles: 32,
  maxSubjectUnits: 200, timeoutMs: 2000,
});

const RULE_SEVERITY = Object.freeze({
  'release-note-review': 'error',
  'history-invalid': 'warning',
  'package-invalid': 'warning',
  'commit-invalid': 'warning',
  'commit-duplicate': 'warning',
  'subject-unsupported': 'warning',
  'path-invalid': 'warning',
  'revert-unresolved': 'warning',
  'revert-ambiguous': 'warning',
  'limit-exceeded': 'warning',
  'clock-invalid': 'warning',
  'input-unreadable': 'warning',
  'input-invalid': 'warning',
  'path-outside-root': 'warning',
  'input-alias-unsupported': 'warning',
});
const byCodeUnit = (a, b) => a === b ? 0 : a < b ? -1 : 1;
const safePath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;
export const isSafePath = value => typeof value === 'string' && value.length <= 256 && safePath.test(value) &&
  !value.split('/').some(part => !part || part === '.');

export function incompleteInput(file, ruleId, pointer = '') {
  if (!isSafePath(file) || !['input-unreadable', 'input-invalid', 'path-outside-root',
    'input-alias-unsupported', 'limit-exceeded'].includes(ruleId)) throw new ConfigError('Invalid input report.');
  const message = {
    'input-unreadable': 'Named export could not be read or decoded.',
    'input-invalid': 'Named export is not supported JSON history.',
    'path-outside-root': 'Named export resolves outside the declared root.',
    'input-alias-unsupported': 'Named export is an alias with ambiguous provenance.',
    'limit-exceeded': 'Named export exceeds the byte limit.',
  }[ruleId];
  return { schemaVersion: '1', tool: TOOL_ID, status: 'incomplete',
    summary: { checked: 0, errors: 0, warnings: 1, commits: 0, packages: 0, features: 0, candidates: 0, reverts: 0 },
    findings: [{ ruleId, severity: RULE_SEVERITY[ruleId], message,
      location: { file, ...(pointer ? { pointer } : {}) } }],
    packageGroups: [], featureGroups: [], commits: [], releaseNotes: [], relationships: [] };
}
const isId = value => typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value);
const SUBJECT = /^(feat|fix|perf|docs|refactor|test|build|ci|chore|revert)\(([A-Za-z0-9._-]{1,64})\)(!)?: ([^\r\n\u2028\u2029]{1,200})$/u;
const visible = value => value.replace(/[\p{Default_Ignorable_Code_Point}\p{Cc}\p{Zl}\p{Zp}\s]/gu, '').length > 0;

function subjectParts(subject, maxSubjectUnits) {
  if (typeof subject !== 'string' || subject.length > maxSubjectUnits) return null;
  const match = SUBJECT.exec(subject);
  return match && visible(match[4]) ? { kind: match[1], scope: match[2], breaking: Boolean(match[3]) } : null;
}

function checkedLimits(limits) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) throw new ConfigError('Invalid limits.');
  for (const [key, value] of Object.entries(limits)) {
    if (!(key in DEFAULT_LIMITS) || !Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key]) {
      throw new ConfigError('Invalid limit.');
    }
  }
  return { ...DEFAULT_LIMITS, ...limits };
}

export function summarizeHistory(document, { now = Date.now, file = 'input.json', limits = {} } = {}) {
  if (typeof now !== 'function' || !isSafePath(file)) throw new ConfigError('Invalid clock or source label.');
  const bounds = checkedLimits(limits);
  const findings = [];
  const packageGroups = [];
  const featureGroups = [];
  const commits = [];
  const releaseNotes = [];
  const relationships = [];
  let incomplete = false;
  let checked = 0;
  const add = (ruleId, pointer, message) => {
    const severity = RULE_SEVERITY[ruleId];
    if (!severity) throw Error('Unknown report rule.');
    findings.push({ ruleId, severity, message, location: { file, pointer } });
    if (severity === 'warning') incomplete = true;
  };
  let firstTime;
  let lastTime;
  try { firstTime = now(); if (!Number.isFinite(firstTime)) throw Error(); lastTime = firstTime; }
  catch { add('clock-invalid', '/clock', 'Injected clock did not return a finite value.'); }
  const tick = () => {
    if (firstTime === undefined || !Number.isFinite(firstTime)) return false;
    let current;
    try { current = now(); } catch { current = NaN; }
    if (!Number.isFinite(current) || current < lastTime) {
      if (!findings.some(f => f.ruleId === 'clock-invalid')) add('clock-invalid', '/clock', 'Injected clock is not finite and monotone.');
      return false;
    }
    lastTime = current;
    if (current - firstTime > bounds.timeoutMs) {
      if (!findings.some(f => f.ruleId === 'limit-exceeded' && f.location.pointer === '/limits/timeoutMs')) {
        add('limit-exceeded', '/limits/timeoutMs', 'Analysis deadline exceeded.');
      }
      return false;
    }
    return true;
  };
  const finish = () => {
    tick();
    findings.sort((a, b) => byCodeUnit(a.location.file, b.location.file) ||
      byCodeUnit(a.location.pointer, b.location.pointer) || byCodeUnit(a.ruleId, b.ruleId));
    const errors = findings.filter(f => f.severity === 'error').length;
    const warnings = findings.filter(f => f.severity === 'warning').length;
    return { schemaVersion: '1', tool: TOOL_ID, status: incomplete ? 'incomplete' : errors ? 'fail' : 'pass',
      summary: { checked, errors, warnings, commits: Array.isArray(document?.commits) ? document.commits.length : 0,
        packages: packageGroups.length, features: featureGroups.length,
        candidates: releaseNotes.length, reverts: relationships.length },
      findings, packageGroups, featureGroups, commits, releaseNotes, relationships };
  };
  if (!document || typeof document !== 'object' || Array.isArray(document) || document.schemaVersion !== '1' ||
      !Array.isArray(document.packageRoots) || !Array.isArray(document.commits) || document.commits.length === 0) {
    add('history-invalid', '/', 'Saved history export is unsupported or empty.');
    return finish();
  }
  if (Object.keys(document).some(key => !['schemaVersion', 'packageRoots', 'commits'].includes(key))) {
    add('history-invalid', '/', 'Saved history export has unsupported fields.');
  }
  const roots = [];
  const seenRoots = new Set();
  const rootsTruncated = document.packageRoots.length > bounds.maxPackageRoots;
  if (rootsTruncated) add('limit-exceeded', '/limits/maxPackageRoots', 'Package-root count exceeds limit.');
  for (const [index, path] of document.packageRoots.slice(0, bounds.maxPackageRoots).entries()) {
    if (!tick()) break;
    if (!isSafePath(path) || seenRoots.has(path)) {
      add('package-invalid', `/packageRoots/${index}`, 'Package root is unsafe or duplicated.');
      continue;
    }
    seenRoots.add(path);
    roots.push({ path, sourcePointer: `/packageRoots/${index}` });
  }
  roots.sort((a, b) => byCodeUnit(a.path, b.path));
  for (const [index, root] of roots.entries()) {
    packageGroups.push({ ordinal: index + 1, sourcePointer: root.sourcePointer, commitOrdinals: [] });
  }
  const idIndex = new Map();
  const duplicateIds = new Set();
  const parsed = [];
  if (document.commits.length > bounds.maxCommits) add('limit-exceeded', '/limits/maxCommits', 'Commit count exceeds limit.');
  for (const [index, item] of document.commits.slice(0, bounds.maxCommits).entries()) {
    if (!tick()) break;
    const pointer = `/commits/${index}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      add('commit-invalid', pointer, 'Commit record is unsupported.');
      parsed.push({ id: null, kind: null, scope: null, breaking: false, reverts: null });
      commits.push({ ordinal: index + 1, pointer, kind: null, breaking: false, packageOrdinals: null,
        featureOrdinal: null, revertsOrdinal: null, revertedByOrdinal: null, releaseNote: 'unknown' });
      continue;
    }
    if (Object.keys(item).some(key => !['id', 'subject', 'files', 'reverts'].includes(key))) {
      add('commit-invalid', pointer, 'Commit record has unsupported fields.');
    }
    const id = isId(item.id) ? item.id : null;
    if (!id) add('commit-invalid', `${pointer}/id`, 'Commit identity is unavailable or unsupported.');
    else if (idIndex.has(id)) {
      duplicateIds.add(id);
      add('commit-duplicate', `${pointer}/id`, 'Commit identity is duplicated.');
    } else idIndex.set(id, index);
    if (typeof item.subject === 'string' && item.subject.length > bounds.maxSubjectUnits) {
      add('limit-exceeded', '/limits/maxSubjectUnits', 'Commit subject exceeds unit limit.');
    }
    const subject = subjectParts(item.subject, bounds.maxSubjectUnits);
    if (!subject) add('subject-unsupported', `${pointer}/subject`, 'Commit subject is outside the supported profile.');
    const files = item.files;
    let validFiles = Array.isArray(files) && files.length > 0;
    if (!validFiles) add('commit-invalid', `${pointer}/files`, 'Commit file evidence is missing or unsupported.');
    else if (files.length > bounds.maxFiles) {
      add('limit-exceeded', '/limits/maxFiles', 'Changed-file count exceeds limit.');
      validFiles = false;
    } else for (const [fileIndex, path] of files.entries()) {
      if (!isSafePath(path)) {
        add('path-invalid', `${pointer}/files/${fileIndex}`, 'Changed-file path cannot be used safely.');
        validFiles = false;
      }
    }
    const hasReverts = Object.hasOwn(item, 'reverts');
    const reverts = hasReverts && isId(item.reverts) ? item.reverts : null;
    if (!hasReverts || (item.reverts !== null && !reverts)) {
      add('revert-unresolved', `${pointer}/reverts`, 'Revert reference is unavailable or unsupported.');
    } else if (subject?.kind === 'revert' && reverts === null) {
      add('revert-unresolved', `${pointer}/reverts`, 'Revert target was not identified.');
    } else if (subject?.kind !== 'revert' && reverts !== null) {
      add('revert-ambiguous', `${pointer}/reverts`, 'A non-revert commit declares a revert target.');
    }
    const packageOrdinals = [];
    if (rootsTruncated) validFiles = false;
    if (validFiles) {
      for (const path of files) {
        const target = [...roots].sort((a, b) => b.path.length - a.path.length || byCodeUnit(a.path, b.path))
          .find(root => path.startsWith(`${root.path}/`));
        const ordinal = target ? roots.indexOf(target) + 1 : 0;
        if (!packageOrdinals.includes(ordinal)) packageOrdinals.push(ordinal);
      }
      packageOrdinals.sort((a, b) => a - b);
    }
    parsed.push({ id, kind: subject?.kind ?? null, scope: subject?.scope ?? null,
      breaking: subject?.breaking ?? false, reverts });
    commits.push({ ordinal: index + 1, pointer, kind: subject?.kind ?? null, breaking: subject?.breaking ?? false,
      packageOrdinals: validFiles ? packageOrdinals : null, featureOrdinal: null,
      revertsOrdinal: null, revertedByOrdinal: null, releaseNote: subject && validFiles && id ? 'none' : 'unknown' });
    if (subject && validFiles && id) checked++;
  }
  if (commits.some(row => row.packageOrdinals?.includes(0))) {
    packageGroups.unshift({ ordinal: 0, sourcePointer: '/packageRoots', commitOrdinals: [] });
  }
  for (const row of commits) {
    for (const ordinal of row.packageOrdinals ?? []) {
      const group = packageGroups.find(x => x.ordinal === ordinal);
      group?.commitOrdinals.push(row.ordinal);
    }
  }
  const scopes = [...new Set(parsed.map(item => item.scope).filter(x => x !== null))].sort(byCodeUnit);
  for (const [index, scope] of scopes.entries()) {
    const first = parsed.findIndex(item => item.scope === scope);
    featureGroups.push({ ordinal: index + 1, sourcePointer: `/commits/${first}/subject`, commitOrdinals: [] });
  }
  for (const [index, item] of parsed.entries()) {
    if (item.scope === null) continue;
    const ordinal = scopes.indexOf(item.scope) + 1;
    commits[index].featureOrdinal = ordinal;
    featureGroups[ordinal - 1].commitOrdinals.push(index + 1);
  }
  for (const [index, item] of parsed.entries()) {
    if (item.kind !== 'revert' || !item.reverts) continue;
    const pointer = `/commits/${index}/reverts`;
    const targetIndex = idIndex.get(item.reverts);
    if (targetIndex === undefined) {
      add('revert-unresolved', pointer, 'Revert target is outside the saved export.');
      continue;
    }
    if (duplicateIds.has(item.reverts) || targetIndex === index || !parsed[targetIndex].kind) {
      add('revert-ambiguous', pointer, 'Revert target cannot be identified uniquely.');
      if (duplicateIds.has(item.reverts)) {
        for (const [candidateIndex, candidate] of parsed.entries()) {
          if (candidate.id === item.reverts) commits[candidateIndex].releaseNote = 'uncertain';
        }
      } else commits[targetIndex].releaseNote = 'uncertain';
      continue;
    }
    const target = commits[targetIndex];
    const row = commits[index];
    row.revertsOrdinal = targetIndex + 1;
    relationships.push({ revertOrdinal: index + 1, targetOrdinal: targetIndex + 1, sourcePointer: pointer });
    if (target.revertedByOrdinal !== null) {
      add('revert-ambiguous', pointer, 'More than one revert targets the same commit.');
      target.releaseNote = 'uncertain';
      continue;
    }
    target.revertedByOrdinal = index + 1;
    if (parsed[targetIndex].kind === 'revert') {
      add('revert-ambiguous', pointer, 'A revert of a revert has unknown net effect.');
      target.releaseNote = 'uncertain';
      const earlier = target.revertsOrdinal;
      if (earlier !== null) commits[earlier - 1].releaseNote = 'uncertain';
    } else target.releaseNote = 'reverted';
  }
  // Export order is not chronology. Resolve the uncertainty after every link is known.
  for (const relation of relationships) {
    if (parsed[relation.targetOrdinal - 1].kind !== 'revert') continue;
    let prior = commits[relation.targetOrdinal - 1].revertsOrdinal;
    const visited = new Set();
    while (prior !== null && !visited.has(prior)) {
      visited.add(prior);
      commits[prior - 1].releaseNote = 'uncertain';
      prior = commits[prior - 1].revertsOrdinal;
    }
  }
  // A later, unexamined commit can revert any visible change or undo a visible
  // revert. Keep observed links, but do not assert the net release-note state.
  if (commits.length < document.commits.length) {
    for (const row of commits) row.releaseNote = 'unknown';
  }
  for (const [index, item] of parsed.entries()) {
    const row = commits[index];
    if (row.releaseNote !== 'none' || item.kind === 'revert') continue;
    if (!['feat', 'fix', 'perf'].includes(item.kind) && !item.breaking) continue;
    row.releaseNote = 'candidate';
    const kind = item.breaking ? 'breaking' : item.kind === 'feat' ? 'feature'
      : item.kind === 'fix' ? 'fix' : 'performance';
    releaseNotes.push({ commitOrdinal: index + 1, kind, packageOrdinals: row.packageOrdinals,
      sourcePointer: `/commits/${index}/subject` });
    add('release-note-review', `/commits/${index}/subject`, 'Saved change is a release-note review candidate.');
  }
  return finish();
}
