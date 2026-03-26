"""
Bid endpoints — BM, DA, DA curves, ID bids.
"""

import json
import time
from typing import Optional, Dict, Any, List
from datetime import datetime

from fastapi import APIRouter, HTTPException

from db import db
from ws import manager
from engine import game_loop
from engine.asset_physics import avail_mw
from engine.constants import ASSETS
from engine.market_engine import compute_indicative_residual

router = APIRouter(prefix="/api/rooms", tags=["bids"])

# ── rate limiting ─────────────────────────────────────────────────────

_bid_timestamps: Dict[str, List[float]] = {}
_RATE_LIMIT_PER_SEC = 10


def _check_rate_limit(player_id: str) -> None:
    """Raise 429 if player exceeds bid rate limit."""
    now = time.time()
    timestamps = _bid_timestamps.get(player_id, [])
    timestamps = [t for t in timestamps if now - t < 1.0]
    if len(timestamps) >= _RATE_LIMIT_PER_SEC:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    timestamps.append(now)
    _bid_timestamps[player_id] = timestamps


# ── bid validation helpers ────────────────────────────────────────────

MAX_PRICE = 9999.99
MIN_PRICE = -500.0
MAX_MW = 5000.0


def _validate_bid(bid: Dict[str, Any], require_side: bool = True) -> None:
    """Raise HTTPException if bid fields are invalid."""
    mw = bid.get("mw")
    price = bid.get("price")

    if mw is None or not isinstance(mw, (int, float)) or mw <= 0:
        raise HTTPException(status_code=422, detail="mw must be a positive number")
    if mw > MAX_MW:
        raise HTTPException(status_code=422, detail=f"mw cannot exceed {MAX_MW}")
    if price is None or not isinstance(price, (int, float)):
        raise HTTPException(status_code=422, detail="price must be a number")
    if price < MIN_PRICE or price > MAX_PRICE:
        raise HTTPException(status_code=422, detail=f"price must be between {MIN_PRICE} and {MAX_PRICE}")
    if require_side:
        side = bid.get("side")
        if not side or side not in ("offer", "bid", "buy", "sell"):
            raise HTTPException(status_code=422, detail="side must be one of: offer, bid, buy, sell")


def _validate_da_curve(curve: Dict[str, Any]) -> None:
    """Raise HTTPException if DA curve segments are malformed."""
    segments = curve.get("segments")
    if segments is not None and not isinstance(segments, list):
        raise HTTPException(status_code=422, detail="segments must be a list")
    for i, seg in enumerate(segments or []):
        if not isinstance(seg, dict):
            raise HTTPException(status_code=422, detail=f"segment {i} must be an object")
        sp_start = seg.get("spStart")
        sp_end = seg.get("spEnd")
        if sp_start is not None and (not isinstance(sp_start, (int, float)) or sp_start < 1 or sp_start > 48):
            raise HTTPException(status_code=422, detail=f"segment {i}: spStart must be 1-48")
        if sp_end is not None and (not isinstance(sp_end, (int, float)) or sp_end < 1 or sp_end > 48):
            raise HTTPException(status_code=422, detail=f"segment {i}: spEnd must be 1-48")
        pmax = seg.get("pmax")
        if pmax is not None and (not isinstance(pmax, (int, float)) or pmax < 0):
            raise HTTPException(status_code=422, detail=f"segment {i}: pmax must be >= 0")
    side = curve.get("side")
    if side and side not in ("buy", "sell", "both"):
        raise HTTPException(status_code=422, detail="side must be one of: buy, sell, both")


def _check_avail_mw(room_id: str, player_id: str, mw: float) -> None:
    """Raise 422 if bid MW exceeds asset's available capacity."""
    try:
        rs = game_loop._get_room(room_id)
        ps = rs.get("playerStates", {}).get(player_id)
        if not ps:
            return  # player not yet in game state — allow (defensive)
        asset_key = ps.get("asset", "")
        asset_def = ASSETS.get(asset_key)
        if not asset_def:
            return  # unknown asset — fall back to global MAX_MW cap
        sp = rs.get("currentSp", 0)
        market = rs.get("markets", {}).get(sp, {})
        soc = ps.get("soc", 50)
        available = avail_mw(asset_def, soc, market)
        if available > 0 and mw > available * 1.05:  # 5% tolerance for rounding
            raise HTTPException(
                status_code=422,
                detail=f"mw {mw} exceeds asset available capacity {available:.1f} MW",
            )
    except HTTPException:
        raise
    except Exception:
        pass  # non-fatal — fall back to global MAX_MW cap


async def _verify_player_in_room(room_id: str, player_id: str) -> None:
    """Raise HTTPException if player doesn't exist in the specified room."""
    rows = await db.query(
        "SELECT 1 FROM players WHERE player_id = $1 AND room_id = $2",
        player_id, room_id,
    )
    if not rows:
        raise HTTPException(status_code=403, detail="Player not found in room")


# ── gate closure enforcement ──────────────────────────────────────────

# Maps market type to the (dayPhase, bmSubPhase) that must be active.
_GATE_RULES: Dict[str, Dict[str, Any]] = {
    "bm": {"dayPhase": "REALTIME", "bmSubPhase": "BM_OPEN"},
    "da": {"dayPhase": "DA"},
    "da_curve": {"dayPhase": "DA"},
    "id": {"dayPhase": "ID_ROUNDS"},
    "ida1": {"dayPhase": "IDA1"},
    "ida2": {"dayPhase": "IDA2"},
}


def _check_gate_open(room_id: str, market_type: str) -> None:
    """Raise 403 if bids are submitted outside the valid trading phase."""
    rule = _GATE_RULES.get(market_type)
    if not rule:
        return
    try:
        rs = game_loop._get_room(room_id)
    except Exception:
        return  # room not initialised yet — allow (defensive)
    day_phase = rs.get("dayPhase")
    if day_phase != rule["dayPhase"]:
        raise HTTPException(
            status_code=403,
            detail=f"Gate closed for {market_type} bids in phase {day_phase}",
        )
    if "bmSubPhase" in rule and rs.get("bmSubPhase") != rule["bmSubPhase"]:
        raise HTTPException(
            status_code=403,
            detail=f"Gate closed for {market_type} bids in sub-phase {rs.get('bmSubPhase')}",
        )


# ==================== BM BIDS ====================

@router.get("/{room_id}/bm/{sp}")
async def get_bm_bids(room_id: str, sp: int):
    """Get BM bids for SP"""
    try:
        result = await db.query(
            "SELECT * FROM bm_bids WHERE room_id = $1 AND sp = $2",
            room_id, sp
        )
        return [dict(row) for row in result]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{room_id}/bm/{sp}/{player_id}")
async def put_bm_bid(room_id: str, sp: int, player_id: str, bid: Dict[str, Any]):
    """Submit BM bid"""
    _validate_bid(bid)
    _check_gate_open(room_id, "bm")
    _check_rate_limit(player_id)
    _check_avail_mw(room_id, player_id, bid.get("mw", 0))
    await _verify_player_in_room(room_id, player_id)
    try:
        await db.execute(
            '''INSERT INTO bm_bids 
               (room_id, sp, player_id, name, asset, mw, price, side, col, is_bot)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (room_id, sp, player_id) DO UPDATE SET
               name = EXCLUDED.name,
               asset = EXCLUDED.asset,
               mw = EXCLUDED.mw,
               price = EXCLUDED.price,
               side = EXCLUDED.side,
               col = EXCLUDED.col,
               is_bot = EXCLUDED.is_bot''',
            room_id, sp, player_id,
            bid.get("name"),
            bid.get("asset"),
            bid.get("mw"),
            bid.get("price"),
            bid.get("side"),
            bid.get("col"),
            bid.get("isBot", False)
        )

        # Also update in-memory order book for live NIV + BM clearing
        game_loop.submit_bm_bid(room_id, player_id, bid)

        # Compute indicative residual for live NIV display
        rs = game_loop._get_room(room_id)
        market = rs.get("markets", {}).get(sp, {})
        actual = market.get("actual", {})
        raw_niv = float(actual.get("rawImbalanceMw", actual.get("niv", 0)))
        is_short = actual.get("isShort", False)
        all_bids = list(rs.get("bmOrderBook", {}).values())
        indic = compute_indicative_residual(raw_niv, is_short, all_bids)

        await manager.broadcast_to_room(room_id, {"type": "bm_bid", "sp": sp, "data": bid})
        # Separate broadcast for live NIV (picked up by meta channel subscribers)
        await manager.broadcast_to_room(room_id, {
            "type": "bm_niv_update", "sp": sp,
            "data": {
                "indicativeResidual": indic["residual"],
                "coverage": indic["coverage"],
                "totalBidMw": indic["totalBidMw"],
                "bidCount": indic["bidCount"],
                "rawNiv": raw_niv,
                "isShort": is_short,
            },
        })
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== DA BIDS ====================

@router.get("/{room_id}/da/{cycle}")
async def get_da_bids(room_id: str, cycle: int, player_id: Optional[str] = None):
    """Get DA bids for cycle"""
    try:
        if player_id:
            result = await db.query(
                "SELECT * FROM da_bids WHERE room_id = $1 AND cycle = $2 AND player_id = $3",
                room_id, cycle, player_id
            )
        else:
            result = await db.query(
                "SELECT * FROM da_bids WHERE room_id = $1 AND cycle = $2",
                room_id, cycle
            )
        return [dict(row) for row in result]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{room_id}/da/{cycle}/{player_id}")
async def put_da_bid(room_id: str, cycle: int, player_id: str, bid: Dict[str, Any]):
    """Submit DA bid"""
    _validate_bid(bid)
    _check_gate_open(room_id, "da")
    _check_rate_limit(player_id)
    await _verify_player_in_room(room_id, player_id)
    try:
        await db.execute(
            '''INSERT INTO da_bids 
               (room_id, cycle, player_id, name, asset, mw, price, side, col, is_bot)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (room_id, cycle, player_id) DO UPDATE SET
               name = EXCLUDED.name,
               asset = EXCLUDED.asset,
               mw = EXCLUDED.mw,
               price = EXCLUDED.price,
               side = EXCLUDED.side,
               col = EXCLUDED.col,
               is_bot = EXCLUDED.is_bot''',
            room_id, cycle, player_id,
            bid.get("name"),
            bid.get("asset"),
            bid.get("mw"),
            bid.get("price"),
            bid.get("side"),
            bid.get("col"),
            bid.get("isBot", False)
        )

        await manager.broadcast_to_room(room_id, {"type": "da_bid", "cycle": cycle, "data": bid})
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== DA CURVES ====================

@router.post("/{room_id}/da_curves/{player_id}")
async def put_da_curve(room_id: str, player_id: str, curve: Dict[str, Any]):
    """Submit DA curve"""
    _validate_da_curve(curve)
    _check_gate_open(room_id, "da_curve")
    _check_rate_limit(player_id)
    await _verify_player_in_room(room_id, player_id)
    try:
        await db.execute(
            '''INSERT INTO da_curves 
               (room_id, player_id, segments, blocks, side, name, asset, col, ts)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (room_id, player_id) DO UPDATE SET
               segments = EXCLUDED.segments,
               blocks = EXCLUDED.blocks,
               side = EXCLUDED.side,
               name = EXCLUDED.name,
               asset = EXCLUDED.asset,
               col = EXCLUDED.col,
               ts = EXCLUDED.ts''',
            room_id, player_id,
            json.dumps(curve.get("segments", [])),
            json.dumps(curve.get("blocks", [])),
            curve.get("side"),
            curve.get("name"),
            curve.get("asset"),
            curve.get("col"),
            curve.get("ts", int(datetime.now().timestamp() * 1000))
        )

        # Keep authoritative in-memory game loop in sync with persisted curve state.
        game_loop.submit_da_curve(room_id, player_id, {
            "segments": curve.get("segments", []),
            "blocks": curve.get("blocks", []),
            "side": curve.get("side", "sell"),
            "name": curve.get("name"),
            "asset": curve.get("asset"),
            "col": curve.get("col"),
            "ts": curve.get("ts", int(datetime.now().timestamp() * 1000)),
        })

        await manager.broadcast_to_room(room_id, {"type": "da_curve", "player_id": player_id, "data": curve})
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== ID BIDS ====================

@router.get("/{room_id}/id/{sp}")
async def get_id_bids(room_id: str, sp: int, player_id: Optional[str] = None):
    """Get ID bids for SP"""
    try:
        if player_id:
            result = await db.query(
                "SELECT * FROM id_bids WHERE room_id = $1 AND sp = $2 AND player_id = $3",
                room_id, sp, player_id
            )
        else:
            result = await db.query(
                "SELECT * FROM id_bids WHERE room_id = $1 AND sp = $2",
                room_id, sp
            )
        return [dict(row) for row in result]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{room_id}/id/{sp}/{player_id}")
async def put_id_bid(room_id: str, sp: int, player_id: str, bid: Dict[str, Any]):
    """Submit ID bid"""
    _validate_bid(bid)
    _check_gate_open(room_id, "id")
    _check_rate_limit(player_id)
    await _verify_player_in_room(room_id, player_id)
    try:
        await db.execute(
            '''INSERT INTO id_bids 
               (room_id, sp, player_id, name, asset, mw, price, side, col, is_bot)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (room_id, sp, player_id) DO UPDATE SET
               name = EXCLUDED.name,
               asset = EXCLUDED.asset,
               mw = EXCLUDED.mw,
               price = EXCLUDED.price,
               side = EXCLUDED.side,
               col = EXCLUDED.col,
               is_bot = EXCLUDED.is_bot''',
            room_id, sp, player_id,
            bid.get("name"),
            bid.get("asset"),
            bid.get("mw"),
            bid.get("price"),
            bid.get("side"),
            bid.get("col"),
            bid.get("isBot", False)
        )

        await manager.broadcast_to_room(room_id, {"type": "id_bid", "sp": sp, "data": bid})

        # Also populate the engine's in-memory ID order book so
        # advance_day_phase → _on_id_close() can clear against real submitted orders.
        try:
            rs = game_loop._get_room(room_id)
            existing = rs.get("idOrderBook", {}).get(player_id, [])
            updated = [o for o in existing if o.get("sp") != sp]
            updated.append({
                "sp": sp,
                "side": bid.get("side"),
                "mw": float(bid.get("mw", 0)),
                "price": float(bid.get("price", 0)),
            })
            game_loop.submit_id_orders(room_id, player_id, updated)
        except Exception:
            pass  # Non-fatal: advance-day will still try to load from DB

        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
