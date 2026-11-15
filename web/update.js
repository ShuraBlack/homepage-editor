// Opt-in update check against the latest GitHub release. Runs in the browser (the container needs no internet access),
// at most once a day; the result is cached in localStorage. No browser globals at import time (tests/update.test.mjs).
export const REPO = 'ShuraBlack/homepage-editor';
const KEY = 'hpe-update';
const DAY = 864e5;

/** True if version `a` (e.g. "v1.2.0") is newer than `b` ("1.1.9"); anything that is not MAJOR.MINOR.PATCH → false. */
export function isNewer(a, b) {
  const parse = (v) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '').trim())?.slice(1).map(Number);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** Last result {at, latest, url, error?} or null. `latest` is null while the repo has no release. */
export const cachedUpdate = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };

/** Ask GitHub for the latest release unless the last check is younger than a day (`force` skips that). */
export async function checkUpdate(force = false) {
  const prev = cachedUpdate();
  if (!force && prev && Date.now() - prev.at < DAY) return prev;
  let v;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (r.status === 404) v = { latest: null, url: null }; // no release published yet
    else if (!r.ok) throw new Error(`GitHub ${r.status}`);
    else { const j = await r.json(); v = { latest: j.tag_name, url: j.html_url }; }
  } catch (e) {
    v = { latest: prev?.latest ?? null, url: prev?.url ?? null, error: e.message }; // offline: retry tomorrow, keep the last answer
  }
  v.at = Date.now();
  localStorage.setItem(KEY, JSON.stringify(v));
  dispatchEvent(new Event('hpe-update'));
  return v;
}
