// Run with: node --test   (from the repo root)
import test from 'node:test';
import assert from 'node:assert/strict';
import { lineDiff } from '../web/diff.js';

// applying the diff must give back both texts
const sides = (d) => [d.filter(([o]) => o !== '+').map(([, l]) => l).join('\n'), d.filter(([o]) => o !== '-').map(([, l]) => l).join('\n')];

test('equal texts have no changes', () => {
  assert.ok(lineDiff('a\nb', 'a\nb').every(([o]) => o === ' '));
});

test('insert, delete and change in the middle', () => {
  const a = 'a\nb\nc\nd\ne';
  const b = 'a\nB\nc\ne\nf';
  const d = lineDiff(a, b);
  assert.deepEqual(sides(d), [a, b]);
  assert.deepEqual(d.filter(([o]) => o !== ' '), [['-', 'b'], ['+', 'B'], ['-', 'd'], ['+', 'f']]);
});

test('empty sides and CRLF', () => {
  assert.deepEqual(sides(lineDiff('', 'x\ny')), ['', 'x\ny']);
  assert.deepEqual(sides(lineDiff('x\r\ny', '')), ['x\ny', '']);
});

test('random edits round-trip', () => {
  let seed = 7;
  const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  for (let k = 0; k < 200; k++) {
    const a = Array.from({ length: rnd(12) }, () => 'abc'[rnd(3)]);
    const b = Array.from({ length: rnd(12) }, () => 'abc'[rnd(3)]);
    const d = lineDiff(a.join('\n'), b.join('\n'));
    assert.deepEqual(sides(d), [a.join('\n'), b.join('\n')]);
  }
});
