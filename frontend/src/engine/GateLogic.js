/**
 * Gate‑closure helper for BM bids.
 *
 * Rules:
 *  - Bids are only accepted during BM phases (BM_OPEN, REALTIME, or legacy "BM").
 *  - After gate closure (timer expired), new bids must be rejected.
 *
 * msLeftMs is the remaining time in milliseconds for the current SP phase.
 * We treat msLeftMs <= 0 as "gate closed".
 */
const BM_PHASES = new Set(["BM", "BM_OPEN", "REALTIME"]);

export function canSubmitBmBid(phase, msLeftMs = Infinity) {
  if (!BM_PHASES.has(phase)) return false;
  return msLeftMs > 0;
}


