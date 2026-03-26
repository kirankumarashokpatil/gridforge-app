"""
Authoritative engine endpoints — thin HTTP adapters.

All game logic lives in ``room_worker.py``; these routes parse the HTTP
request, send a command through the message bus, relay any broadcasts to
the room's WS clients, and return the result.
"""

from typing import Optional, Dict, Any

from fastapi import APIRouter, HTTPException, Request

from ws import manager
from bus import MessageBus

router = APIRouter(prefix="/api/rooms", tags=["engine"])

# Injected by server.py during startup via ``set_bus()``.
_bus: MessageBus | None = None


def set_bus(bus: MessageBus) -> None:
    global _bus
    _bus = bus


async def _run(room_id: str, command: str, data: dict | None = None):
    """Execute a worker command and broadcast the results."""
    cr = await _bus.send_command(room_id, command, data)
    if cr.error:
        raise HTTPException(status_code=cr.status_code, detail=cr.error)
    for msg in cr.broadcasts:
        await manager.broadcast_to_room(room_id, msg)
    return cr.result


# ── player registration & state ─────────────────────────────────────────

@router.post("/{room_id}/engine/register")
async def engine_register_player(room_id: str, data: Dict[str, Any]):
    return await _run(room_id, "register", data)


@router.get("/{room_id}/engine/state")
async def engine_get_state(room_id: str):
    return await _run(room_id, "get_state")


@router.post("/{room_id}/engine/player-ready")
async def player_signal_ready(room_id: str, data: Dict[str, Any]):
    return await _run(room_id, "player_ready", data)


# ── market generation ───────────────────────────────────────────────────

@router.post("/{room_id}/engine/market")
async def engine_generate_market(room_id: str, data: Optional[Dict[str, Any]] = None):
    return await _run(room_id, "generate_market", data or {})


# ── phase advances ──────────────────────────────────────────────────────

@router.post("/{room_id}/engine/advance")
async def engine_advance_phase(room_id: str):
    return await _run(room_id, "advance_phase")


@router.post("/{room_id}/engine/advance-day")
async def engine_advance_day_phase(room_id: str, data: Optional[Dict[str, Any]] = None):
    return await _run(room_id, "advance_day", data)


@router.post("/{room_id}/engine/advance-bm")
async def engine_advance_bm(room_id: str, data: Optional[Dict[str, Any]] = None):
    return await _run(room_id, "advance_bm", data)


@router.post("/{room_id}/engine/advance-game")
async def engine_advance_game(room_id: str, data: Optional[Dict[str, Any]] = None):
    return await _run(room_id, "advance_game", data)


# ── clearing ────────────────────────────────────────────────────────────

@router.post("/{room_id}/engine/clear-bm")
async def engine_clear_bm(room_id: str):
    return await _run(room_id, "clear_bm")


@router.post("/{room_id}/engine/clear-da")
async def engine_clear_da(room_id: str):
    return await _run(room_id, "clear_da")


@router.post("/{room_id}/engine/clear-da-curves")
async def engine_clear_da_curves(room_id: str):
    return await _run(room_id, "clear_da_curves")


@router.post("/{room_id}/engine/ida/{ida_round}/bid")
async def engine_ida_bid(room_id: str, ida_round: str, request: Request):
    body = await request.json()
    body["idaRound"] = ida_round
    return await _run(room_id, "ida_bid", body)


@router.post("/{room_id}/engine/ida/{ida_round}/clear")
async def engine_ida_clear(room_id: str, ida_round: str):
    return await _run(room_id, "ida_clear", {"idaRound": ida_round})


@router.get("/{room_id}/engine/ida/{ida_round}/forecast")
async def engine_ida_forecast(room_id: str, ida_round: str):
    return await _run(room_id, "ida_forecast", {"idaRound": ida_round})


# ── intraday ────────────────────────────────────────────────────────────

@router.post("/{room_id}/engine/id/submit")
async def engine_id_submit(room_id: str, request: Request):
    body = await request.json()
    return await _run(room_id, "id_submit", body)


@router.post("/{room_id}/engine/id/clear")
async def engine_id_clear(room_id: str):
    return await _run(room_id, "id_clear")


# ── settlement ──────────────────────────────────────────────────────────

@router.post("/{room_id}/engine/settle")
async def engine_settle(room_id: str):
    return await _run(room_id, "settle")


# ── forecasts ───────────────────────────────────────────────────────────

@router.get("/{room_id}/engine/forecasts")
async def engine_get_forecasts(room_id: str):
    return await _run(room_id, "get_forecasts")


@router.post("/{room_id}/engine/forecast/publish")
async def engine_publish_forecast(room_id: str, data: Optional[Dict[str, Any]] = None):
    return await _run(room_id, "publish_forecast", data)


# ── config ──────────────────────────────────────────────────────────────

@router.post("/{room_id}/engine/config")
async def engine_set_config(room_id: str, config: Dict[str, Any]):
    return await _run(room_id, "set_config", config)


# ── leaderboard & achievements ──────────────────────────────────────────

@router.get("/{room_id}/engine/leaderboard")
async def engine_get_leaderboard(room_id: str):
    return await _run(room_id, "get_leaderboard")


@router.get("/{room_id}/engine/achievements/{player_id}")
async def engine_get_achievements(room_id: str, player_id: str):
    return await _run(room_id, "get_achievements", {"playerId": player_id})
