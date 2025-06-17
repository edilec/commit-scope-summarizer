import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStrictJson } from '../src/json.mjs';

test('strict JSON accepts the supported saved history shape', () => {
  const value = parseStrictJson('{"schemaVersion":"1","packageRoots":[],"commits":[{"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","subject":"docs(ui): synthetic note","files":["README.md"],"reverts":null}]}');
  assert.equal(value.commits.length, 1);
  assert.equal(value.commits[0].reverts, null);
});

test('escaped-equivalent duplicate keys cannot overwrite history evidence', () => {
  assert.throws(() => parseStrictJson('{"reverts":null,"\\u0072everts":null}'), /Duplicate JSON key/u);
});

test('numeric tokens are unsupported rather than rounded into a history assertion', () => {
  assert.throws(() => parseStrictJson('{"count":1}'), /number/u);
  assert.throws(() => parseStrictJson('{"count":0.999999999999999999}'), /number/u);
});

test('structural depth and node bounds are inclusive at N and refuse N plus one', () => {
  assert.deepEqual(parseStrictJson('{"a":{"b":null}}', { maxDepth: 2 }), { a: { b: null } });
  assert.throws(() => parseStrictJson('{"a":{"b":null}}', { maxDepth: 1 }), /depth/u);
  assert.deepEqual(parseStrictJson('[null,null]', { maxNodes: 3 }), [null, null]);
  assert.throws(() => parseStrictJson('[null,null]', { maxNodes: 2 }), /nodes/u);
});

test('parse failure never includes a synthetic credential-like canary', () => {
  assert.throws(() => parseStrictJson('{"subject": token=SYNTHETIC_SECRET_CANARY}'), error => {
    assert.equal(error.message.includes('SYNTHETIC_SECRET_CANARY'), false);
    return true;
  });
});
