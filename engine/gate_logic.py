"""
GridForge Gate Logic — Python port of src/engine/GateLogic.js

Gate-closure helper for BM bids.
"""

from __future__ import annotations


def can_submit_bm_bid(phase: str, ms_left_ms: float = float("inf")) -> bool:
    """
    Bids are only accepted when phase == "BM".
    After gate closure (timer expired), new bids must be rejected.
    """
    if phase != "BM":
        return False
    return ms_left_ms > 0
