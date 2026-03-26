"""
Player endpoints — CRUD, scores, server-authoritative NESO election.
"""

import json
from typing import Dict, Any
from datetime import datetime

from fastapi import APIRouter, HTTPException

from db import db
from ws import manager
from engine.constants import ROLES, ASSETS

router = APIRouter(prefix="/api/rooms", tags=["players"])

ACTIVE_PLAYER_WINDOW_MS = 120000

# Valid role and asset keys for input validation
_VALID_ROLES = set(ROLES.keys()) | {"UNASSIGNED"}
_VALID_ASSETS = set(ASSETS.keys()) | {None, ""}


@router.get("/{room_id}/players")
async def get_players(room_id: str):
    """Get all players in room"""
    try:
        result = await db.query(
            "SELECT * FROM players WHERE room_id = $1 ORDER BY created_at",
            room_id
        )
        players = []
        for row in result:
            p = dict(row)
            p["id"] = p.get("player_id")
            cfg = p.get("custom_config") or {}
            if isinstance(cfg, str):
                try:
                    cfg = json.loads(cfg)
                except Exception:
                    cfg = {}
            if isinstance(cfg, dict):
                if cfg.get("preferredRole") is not None:
                    p["preferredRole"] = cfg.get("preferredRole")
                if cfg.get("preferredAssetKey") is not None:
                    p["preferredAssetKey"] = cfg.get("preferredAssetKey")
            players.append(p)
        return players
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{room_id}/players/{player_id}")
async def put_player(room_id: str, player_id: str, data: Dict[str, Any]):
    """Create or update player (atomic upsert — race-condition-free).

    Uses INSERT ON CONFLICT DO NOTHING to atomically ensure the row exists,
    then a separate UPDATE for the partial-field changes. Two concurrent calls
    for the same player will both succeed: the loser of the INSERT race does
    nothing on INSERT, then both apply their UPDATE (idempotent for same data).
    """
    try:
        now_ts = int(datetime.now().timestamp() * 1000)

        # Validate role and asset if provided
        if "role" in data and data["role"] and str(data["role"]).upper() not in _VALID_ROLES:
            raise HTTPException(status_code=422, detail=f"Invalid role: {data['role']}")
        if "asset" in data and data["asset"] and data["asset"] not in _VALID_ASSETS:
            raise HTTPException(status_code=422, detail=f"Invalid asset: {data['asset']}")

        # Ensure room exists (auto-create with defaults to satisfy FK constraint)
        await db.execute(
            "INSERT INTO rooms (room_id, scenario_id, phase_start_ts) VALUES ($1, 'NORMAL', $2) ON CONFLICT (room_id) DO NOTHING",
            room_id, now_ts
        )

        # Step 1: Atomic upsert
        _name_val = data.get("name")
        if isinstance(_name_val, str) and not _name_val.strip():
            _name_val = None

        await db.execute(
            """
            INSERT INTO players (player_id, room_id, name, custom_config, cash, da_cash, sof, status, last_seen)
            VALUES ($1, $2, COALESCE($3, ''), '{}', 0, 0, 50, 'UNASSIGNED', $4)
            ON CONFLICT (player_id, room_id) DO UPDATE SET
                name = CASE
                    WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name != ''
                    THEN EXCLUDED.name
                    ELSE players.name
                END,
                last_seen = GREATEST(EXCLUDED.last_seen, players.last_seen)
            """,
            player_id, room_id, _name_val, now_ts
        )

        # Step 2: Partial UPDATE
        field_map = {
            "name": "name",
            "asset": "asset",
            "role": "role",
            "custom_config": "custom_config",
            "cash": "cash",
            "da_cash": "da_cash",
            "sof": "sof",
            "status": "status",
            "ready": "status",
            "assignedAssetKey": "asset",
        }

        # Persist waiting-room preference fields in custom_config
        pref_keys = {"preferredRole", "preferredAssetKey"}
        if any(k in data for k in pref_keys):
            existing_cfg = {}
            current = await db.query(
                "SELECT custom_config FROM players WHERE player_id = $1 AND room_id = $2",
                player_id, room_id
            )
            if current:
                raw_cfg = dict(current[0]).get("custom_config")
                if isinstance(raw_cfg, dict):
                    existing_cfg = raw_cfg
                elif isinstance(raw_cfg, str) and raw_cfg:
                    try:
                        existing_cfg = json.loads(raw_cfg)
                    except Exception:
                        existing_cfg = {}

            if "preferredRole" in data:
                existing_cfg["preferredRole"] = data.get("preferredRole")
            if "preferredAssetKey" in data:
                existing_cfg["preferredAssetKey"] = data.get("preferredAssetKey")

            data = {**data, "custom_config": existing_cfg}

        updates = []
        values = []
        idx = 1

        for key, value in data.items():
            col = field_map.get(key)
            if col is None:
                continue
            if key == "custom_config":
                value = json.dumps(value or {})
            if key in ("name", "role", "asset") and (value is None or (isinstance(value, str) and not value.strip())):
                continue
            if key == "ready":
                if "status" in data:
                    continue
                value = "READY" if value else "ASSIGNED"
            updates.append(f"{col} = ${idx}")
            values.append(value)
            idx += 1

        # Always refresh last_seen and updated_at
        updates.append(f"last_seen = ${idx}")
        values.append(now_ts)
        idx += 1
        updates.append("updated_at = CURRENT_TIMESTAMP")

        if updates:
            values.append(player_id)
            values.append(room_id)
            sql = f"UPDATE players SET {', '.join(updates)} WHERE player_id = ${idx} AND room_id = ${idx + 1}"
            await db.execute(sql, *values)

        # Server-authoritative host/NESO election among active players.
        active_cutoff = now_ts - ACTIVE_PLAYER_WINDOW_MS
        active_rows = await db.query(
            '''SELECT player_id, role, created_at, last_seen
               FROM players
               WHERE room_id = $1
               ORDER BY created_at ASC, player_id ASC''',
            room_id,
        )
        all_players = [dict(row) for row in active_rows]

        def is_recent_created(created_at_val):
            if not created_at_val:
                return False
            try:
                return (datetime.now(created_at_val.tzinfo) - created_at_val).total_seconds() * 1000 < ACTIVE_PLAYER_WINDOW_MS
            except Exception:
                return False

        active_players = []
        for p in all_players:
            last_seen = p.get("last_seen") or 0
            if last_seen == 0:
                if is_recent_created(p.get("created_at")):
                    active_players.append(p)
            elif last_seen >= active_cutoff:
                active_players.append(p)

        if active_players:
            claim_requested = str(data.get("role", "")).upper() == "NESO"
            active_neso = [p for p in active_players if p.get("role") == "NESO"]

            if claim_requested and not active_neso:
                host_id = player_id
            elif active_neso:
                host_id = active_neso[0].get("player_id")
            else:
                host_id = active_players[0].get("player_id")

            if host_id:
                await db.execute(
                    '''UPDATE players
                       SET role = CASE
                               WHEN player_id = $2 THEN 'NESO'
                               WHEN role = 'NESO' THEN 'UNASSIGNED'
                               ELSE role
                           END,
                           status = CASE
                               WHEN player_id = $2 THEN 'ASSIGNED'
                               WHEN role = 'NESO' THEN 'JOINED'
                               ELSE status
                           END,
                           updated_at = CURRENT_TIMESTAMP
                       WHERE room_id = $1
                         AND player_id = ANY($3::text[])
                         AND (player_id = $2 OR role = 'NESO')''',
                    room_id,
                    host_id,
                    [p.get("player_id") for p in active_players if p.get("player_id")],
                )

                if host_id != player_id:
                    host_updated = await db.query(
                        "SELECT * FROM players WHERE player_id = $1 AND room_id = $2",
                        host_id,
                        room_id,
                    )
                    if host_updated:
                        host_record = dict(host_updated[0])
                        host_record["id"] = host_record.get("player_id", host_id)
                        await manager.broadcast_to_room(room_id, {
                            "type": "players",
                            "data": {host_id: host_record}
                        })

        # Fetch the full current player record to broadcast
        updated = await db.query(
            "SELECT * FROM players WHERE player_id = $1 AND room_id = $2",
            player_id, room_id
        )
        player_record = dict(updated[0]) if updated else {"player_id": player_id}
        player_record["id"] = player_record.get("player_id", player_id)
        for extra_key in ("preferredRole", "preferredAssetKey", "ready", "assignedAssetKey"):
            if extra_key in data:
                player_record[extra_key] = data[extra_key]

        await manager.broadcast_to_room(room_id, {
            "type": "players",
            "data": {player_id: player_record}
        })

        final_record = await db.query(
            "SELECT * FROM players WHERE player_id = $1 AND room_id = $2",
            player_id,
            room_id,
        )
        if final_record:
            final_dict = dict(final_record[0])
            final_dict["id"] = final_dict.get("player_id", player_id)
            for extra_key in ("preferredRole", "preferredAssetKey", "ready", "assignedAssetKey"):
                if extra_key in data:
                    final_dict[extra_key] = data[extra_key]
            return {"success": True, "player_id": player_id, **final_dict}

        return {"success": True, "player_id": player_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{room_id}/players/{player_id}/scores")
async def update_player_scores(room_id: str, player_id: str, scores: Dict[str, float]):
    """Update player scores"""
    try:
        await db.execute(
            '''UPDATE players 
               SET role_score = COALESCE($1, role_score),
                   system_score = COALESCE($2, system_score),
                   overall_score = COALESCE($3, overall_score),
                   updated_at = CURRENT_TIMESTAMP
               WHERE player_id = $4 AND room_id = $5''',
            scores.get("roleScore"),
            scores.get("systemScore"),
            scores.get("overallScore"),
            player_id,
            room_id
        )
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
