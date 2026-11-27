# Fast exact Myers line diff — diff-speed-01-run-20261126

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/mrizki158/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/mrizki158/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A faster drop-in for makefun-diff 1.0.0: `solve.js` returns exactly
makefun-diff's patch for every `{ old, new }`, and `main.ts` answers every
case in `/input/cases.json` with it.

## Approach

- Lines are interned once per case to integer ids (one shared `Map`), so
  the search compares ints in `Int32Array`s, never strings.
- Myers's greedy search runs over `Int32Array` V-rows with a full trace
  (one row per depth, zero per-step allocation), then a single backtrack
  rebuilds the edit script using the exact same candidate rule as the
  reference — deletion wins when a deletion and an insertion reach the
  same point — and the same past-the-end gating, so the script is
  bit-identical to makefun-diff's, including its tie-breaks.
- Fast paths for identical texts, empty middles and prefix/suffix-only
  diffs; patch rendering builds the answer with one push per output line
  and a single join.
- No dependencies, no public diff library, JavaScript only.

## Files

- `solve.js` — `run(input)` returns makefun-diff 1.0.0's answer as one
  JSON string (the patch).
- `main.ts` — reads `/input/cases.json`, answers each case with `run`,
  writes `/output/answers.json`.
- `package.json`, `LICENSE` (MIT).
