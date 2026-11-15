// Line diff for the compare dialog (own module without browser dependencies, so tests/diff.test.mjs can run it in Node).
/** Line diff (LCS) as [[op, line]] with op ' ', '-' or '+'. Common head and tail are cut off before the table is built. */
export function lineDiff(a, b) {
  const A = a.split(/\r?\n/);
  const B = b.split(/\r?\n/);
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0;
  while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const a2 = A.slice(s, A.length - e);
  const b2 = B.slice(s, B.length - e);
  const n = a2.length;
  const m = b2.length;
  const out = A.slice(0, s).map((l) => [' ', l]);
  if (n * m > 4e6) {
    // shortcut: a huge changed block is shown as removed + added instead of a minimal diff (keeps the table small)
    out.push(...a2.map((l) => ['-', l]), ...b2.map((l) => ['+', l]));
  } else {
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a2[i] === b2[j]) { out.push([' ', a2[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push(['-', a2[i++]]); else out.push(['+', b2[j++]]);
    }
    while (i < n) out.push(['-', a2[i++]]);
    while (j < m) out.push(['+', b2[j++]]);
  }
  out.push(...A.slice(A.length - e).map((l) => [' ', l]));
  return out;
}
