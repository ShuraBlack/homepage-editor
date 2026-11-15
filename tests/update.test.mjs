// Run with: node --test   (from the repo root)
import test from 'node:test';
import assert from 'node:assert/strict';
import { isNewer } from '../web/update.js';

test('isNewer compares MAJOR.MINOR.PATCH numerically', () => {
  assert.equal(isNewer('v1.0.1', '1.0.0'), true);
  assert.equal(isNewer('v1.10.0', '1.9.9'), true); // not a string comparison
  assert.equal(isNewer('2.0.0', '1.99.99'), true);
  assert.equal(isNewer('v1.0.0', '1.0.0'), false);
  assert.equal(isNewer('v0.9.0', '1.0.0'), false);
});

test('isNewer ignores anything that is not a plain release', () => {
  assert.equal(isNewer('v2.0.0-beta.1', '1.0.0'), false);
  assert.equal(isNewer(null, '1.0.0'), false);
  assert.equal(isNewer('v2.0.0', 'dev'), false);
});
