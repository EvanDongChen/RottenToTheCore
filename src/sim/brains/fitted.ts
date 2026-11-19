// Written by `npm run calibrate -- --write` from 1000 games. Overrides the hand-picked
// likelihood ratios in bayesian.ts. Delete an entry to go back to the hand-picked value.
export const FITTED: Record<string, number> = {
  "kill": 100,
  "vented": 38.53,
  "nearBody": 4.61,
  "fakeTask": 100,
  "caught": 2.77,
  "storyBreak": 100,
  "tailed": 2.59,
  "accusedByTrusted": 2.29,
  "vouchedByTrusted": 1.06,
  "unreachable": 0.58,
  "noAlibi": 1.81
}
