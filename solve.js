// Fast exact drop-in for makefun-diff 1.0.0.
//
// Reimplements makefun-diff's rule from scratch (no public diff library):
// lines split after every "\n" only; common prefix kept, then common suffix
// of what is left; between them Myers's greedy search which keeps on each
// diagonal the path furthest into the old text, and when a deletion and an
// insertion reach the same point the DELETION's path wins, never past either
// text's end, no edge-diagonal pruning, following every run of equal lines
// as far as it goes; first path to reach both ends is the script. Patch
// format: header `makefun-diff/1 old=N new=M hunks=H deleted=D inserted=I`,
// per hunk `@ os ol ns nl` and one line per covered line prefixed `=`/`-`/`+`;
// each change run lists deletions before insertions, shows up to 3 kept
// lines before/after, two runs at most 6 kept lines apart share a hunk; a
// line ending its text with no newline is written with one and followed by
// a line `%`. Identical texts: header line alone.
//
// Speed architecture (the win is architecture, not tuning):
//  - lines are interned once per case to integer ids (one Map, shared by
//    both texts), so the whole search compares ints in Int32Arrays, never
//    strings;
//  - Myers runs over Int32Array V-rows with a full trace (one Int32Array
//    per depth d), zero per-step allocation, then a single backtrack pass
//    that rebuilds the edit script from the trace using the exact same
//    candidate rule (deletion wins ties) and the same past-the-end gating
//    as the forward search, so the reconstructed script is bit-identical
//    to makefun-diff's;
//  - fast paths for identical texts, empty middles and prefix/suffix-only
//    diffs; patch rendering builds the answer with one array push per
//    output line and a single join.

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** Pooled Myers V-rows, indexed by depth d (length 2d+1). */
const rowPool = [];

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

/**
 * The edit-script runs of a into b (both Int32Array of interned line ids):
 * [{ kind, count }] with kind KEEP/DELETE/INSERT, in order. Runs of the
 * same kind are merged; KEEP runs alternate with DELETE/INSERT runs.
 */
function middleRuns(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m === 0 ? [] : [{ kind: INSERT, count: m }];
  if (m === 0) return [{ kind: DELETE, count: n }];

  // ---- forward Myers search, trace[d] = Int32Array(2d+1), index k+d ----
  // trace[d][k+d] = x consumed on diagonal k after d edits + its snake,
  // or -1 when no path of d edits reaches that diagonal. Rows are pooled
  // across cases (every entry is rewritten on each use) to avoid
  // re-allocating and zero-filling ~D^2 ints per case.
  const trace = [];
  let v0 = rowPool[0] ?? (rowPool[0] = new Int32Array(1));
  let x = 0;
  let y = 0;
  while (x < n && y < m && a[x] === b[y]) {
    x++;
    y++;
  }
  v0[0] = x;
  trace.push(v0);
  let D = -1;
  if (x === n && y === m) {
    D = 0;
  } else {
    outer: for (let d = 1; d <= n + m; d++) {
      const cur = rowPool[d] ?? (rowPool[d] = new Int32Array(2 * d + 1));
      const prev = trace[d - 1];
      // prev index for diagonal k-1 is k+d-2, for k+1 is k+d.
      let delIdx = -2; // k=-d: (k-1)+(d-1) = -2, invalid; grows by 2 per k
      let insIdx = 0; // k=-d: (k+1)+(d-1) = 0; grows by 2 per k
      for (let k = -d; k <= d; k += 2) {
        const idx = k + d;
        let delOk = false;
        let insOk = false;
        let candDel = 0;
        let candIns = 0;
        if (k > -d) {
          const px = prev[delIdx];
          if (px >= 0 && px < n) {
            delOk = true;
            candDel = px + 1;
          }
        }
        if (k < d) {
          const px = prev[insIdx];
          if (px >= 0 && px - k - 1 < m) {
            insOk = true;
            candIns = px;
          }
        }
        delIdx += 2;
        insIdx += 2;
        let cx;
        if (delOk && (!insOk || candDel >= candIns)) cx = candDel;
        else if (insOk) cx = candIns;
        else {
          cur[idx] = -1;
          continue;
        }
        let cy = cx - k;
        while (cx < n && cy < m && a[cx] === b[cy]) {
          cx++;
          cy++;
        }
        cur[idx] = cx;
        if (cx === n && cy === m) {
          D = d;
          trace.push(cur);
          break outer;
        }
      }
      trace.push(cur);
    }
  }
  if (D < 0) throw new Error('makefun-diff: the search ended without reaching both ends');

  // ---- backtrack from (n, m) at depth D, rebuilding the script ----
  // rev holds runs in reverse order (from the end backwards).
  const rev = [];
  x = n;
  y = m;
  for (let d = D; d >= 1; d--) {
    const k = x - y;
    const prev = trace[d - 1];
    let delOk = false;
    let insOk = false;
    let candDel = 0;
    let candIns = 0;
    let delPx = 0;
    let insPx = 0;
    if (k > -d) {
      const px = prev[k + d - 2];
      if (px >= 0 && px < n) {
        delOk = true;
        candDel = px + 1;
        delPx = px;
      }
    }
    if (k < d) {
      const px = prev[k + d];
      if (px >= 0 && px - k - 1 < m) {
        insOk = true;
        candIns = px;
        insPx = px;
      }
    }
    // Pre-edit point (ex, ey) on the previous diagonal, post-edit (fx, fy).
    let ex;
    let ey;
    let fx;
    let isDel;
    if (delOk && (!insOk || candDel >= candIns)) {
      isDel = true;
      ex = delPx;
      ey = delPx - (k - 1);
      fx = ex + 1;
    } else if (insOk) {
      isDel = false;
      ex = insPx;
      ey = insPx - (k + 1);
      fx = ex;
    } else {
      throw new Error('makefun-diff: backtrack found no predecessor');
    }
    const keeps = x - fx;
    if (keeps > 0) rev.push({ kind: KEEP, count: keeps });
    rev.push({ kind: isDel ? DELETE : INSERT, count: 1 });
    x = ex;
    y = ey;
  }
  if (x > 0) rev.push({ kind: KEEP, count: x });

  // Reverse and merge consecutive runs of the same kind.
  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const r = rev[i];
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === r.kind) last.count += r.count;
    else runs.push({ kind: r.kind, count: r.count });
  }
  return runs;
}

/** makefun-diff 1.0.0's answer for one case's input { old, new }. */
export function run(input) {
  const oldText = input.old;
  const newText = input.new;

  // Fast path: identical texts are the header line alone.
  if (oldText === newText) {
    let n = 0;
    let i = -1;
    while ((i = oldText.indexOf('\n', i + 1)) !== -1) n++;
    if (oldText !== '' && !oldText.endsWith('\n')) n++;
    return `makefun-diff/1 old=${n} new=${n} hunks=0 deleted=0 inserted=0\n`;
  }

  // ---- tokenize + intern: one Map, line id = base*2 + hasNewline ----
  const oldParts = oldText.split('\n');
  const newParts = newText.split('\n');
  const oldEndsNL = oldText.endsWith('\n');
  const newEndsNL = newText.endsWith('\n');
  const n = oldText === '' ? 0 : oldParts.length - (oldEndsNL ? 1 : 0);
  const m = newText === '' ? 0 : newParts.length - (newEndsNL ? 1 : 0);
  const ids = new Map();
  let nextId = 0;
  const a = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const part = oldParts[i];
    let base = ids.get(part);
    if (base === undefined) {
      base = nextId++;
      ids.set(part, base);
    }
    a[i] = base * 2 + (i === n - 1 && !oldEndsNL ? 0 : 1);
  }
  const b = new Int32Array(m);
  for (let j = 0; j < m; j++) {
    const part = newParts[j];
    let base = ids.get(part);
    if (base === undefined) {
      base = nextId++;
      ids.set(part, base);
    }
    b[j] = base * 2 + (j === m - 1 && !newEndsNL ? 0 : 1);
  }

  // ---- common prefix, then common suffix of what is left ----
  let prefix = 0;
  const pn = n < m ? n : m;
  while (prefix < pn && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  const rn = n - prefix;
  const rm = m - prefix;
  const sn = rn < rm ? rn : rm;
  while (suffix < sn && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;

  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...middleRuns(a.subarray(prefix, n - suffix), b.subarray(prefix, m - suffix)));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // ---- change runs: each a stretch of deletions/insertions ----
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // ---- hunks: change runs at most 2*CONTEXT kept lines apart share one ----
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  // ---- render ----
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  // A line as the patch writes it: op + line, a newline, and "%" on a line
  // of its own when the line ended its text with no newline. Only a text's
  // last line can lack the newline.
  const writtenOld = (op, i) => (i === n - 1 && !oldEndsNL ? `${op}${oldParts[i]}\n%\n` : `${op}${oldParts[i]}\n`);
  const writtenNew = (op, j) => (j === m - 1 && !newEndsNL ? `${op}${newParts[j]}\n%\n` : `${op}${newParts[j]}\n`);
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(writtenOld('=', at));
      for (let i = 0; i < c.dels; i++) out.push(writtenOld('-', c.o + i));
      for (let i = 0; i < c.ins; i++) out.push(writtenNew('+', c.p + i));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(writtenOld('=', at));
  }
  return out.join('');
}
