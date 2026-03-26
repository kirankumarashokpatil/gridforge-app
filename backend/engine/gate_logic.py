"""
GridForge Gate Logic — Python port of src/engine/GateLogic.js

Gate-closure helper for BM bids.
"""

from __future__ import annotations


def can_submit_bm_bid(phase: str, bm_sub_phase: str | None = None,
                      ms_left_ms: float = float("inf")) -> bool:
    """Check whether BM bid submission is currently allowed.

    Bids are accepted when the day-phase is REALTIME and the
    per-SP sub-phase is BM_OPEN, and the gate-closure timer has
    not yet expired.
    """
    if phase != "REALTIME":
        return False
    if bm_sub_phase != "BM_OPEN":
        return False
    return ms_left_ms > 0
