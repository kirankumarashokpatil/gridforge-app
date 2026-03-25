"""
GridForge Leaderboard Engine — Python port of src/engine/LeaderboardEngine.js

Builds multi-dimensional leaderboard from player scores.
"""

from __future__ import annotations
import math


def build_leaderboard(players: list[dict]) -> dict:
    if not players:
        return {"overall": [], "roleWinners": {}, "systemSteward": None, "mostConsistent": None}

    overall = sorted(
        players,
        key=lambda p: (-(p.get("overallScore", 0)), -(p.get("roleScore", 0)), -(p.get("cash", 0))),
    )
    overall = [{**p, "rank": i + 1} for i, p in enumerate(overall)]

    # Role winners
    by_role: dict[str, list[dict]] = {}
    for p in players:
        r = p.get("role", "GENERATOR")
        by_role.setdefault(r, []).append(p)

    role_winners = {}
    for role, role_players in by_role.items():
        best = max(role_players, key=lambda x: x.get("roleScore", 0))
        if best.get("roleScore", 0) > 0:
            role_winners[role] = {"id": best["id"], "name": best["name"], "roleScore": best["roleScore"]}

    # System steward
    system_steward = max(players, key=lambda p: p.get("systemScore", 0))

    # Most consistent
    most_consistent = None
    if players and players[0].get("scoreHistory") and len(players[0]["scoreHistory"]) > 1:
        with_variance = []
        for p in players:
            scores = p.get("scoreHistory", [])
            mean = sum(scores) / len(scores) if scores else 0
            variance = sum((s - mean) ** 2 for s in scores) / len(scores) if scores else 0
            with_variance.append({**p, "variance": variance})
        most_consistent = min(with_variance, key=lambda x: x["variance"])
    else:
        avg_score = sum(p.get("overallScore", 0) for p in players) / len(players)
        most_consistent = min(players, key=lambda p: abs(p.get("overallScore", 0) - avg_score))

    return {"overall": overall, "roleWinners": role_winners, "systemSteward": system_steward, "mostConsistent": most_consistent}


def get_rank_label(rank: int) -> str:
    if rank == 1:
        return "🥇"
    if rank == 2:
        return "🥈"
    if rank == 3:
        return "🥉"
    return f"#{rank}"


def get_score_color(score: int) -> str:
    if score >= 80:
        return "#1de98b"
    if score >= 60:
        return "#38c0fc"
    if score >= 40:
        return "#f5b222"
    if score >= 20:
        return "#f0855a"
    return "#f0455a"


def generate_player_narrative(player: dict | None) -> str:
    if not player:
        return ""

    rs = player.get("roleScore", 0)
    ss = player.get("systemScore", 0)
    role_detail = player.get("roleDetail", {})
    primary_name = role_detail.get("primary", {}).get("name", "Performance") if role_detail else "Performance"
    primary_val = role_detail.get("primary", {}).get("value", "—") if role_detail else "—"

    if rs >= 85:
        tier = "exceptional"
    elif rs >= 70:
        tier = "strong"
    elif rs >= 50:
        tier = "decent"
    elif rs >= 30:
        tier = "struggling"
    else:
        tier = "poor"

    system_note = ""
    if ss >= 80:
        system_note = " — excellent system citizen"
    elif ss >= 60:
        system_note = " — helpful to the grid"
    elif ss <= 30:
        system_note = " — often destabilising"

    role_name = player.get("role", "Player")
    cash = round(player.get("cash", 0))
    return f"{role_name}: {tier} {primary_name} ({primary_val}){system_note}. P&L: £{cash}."


def build_round_debrief(leaderboard_data: dict, system_state: dict) -> dict:
    overall = leaderboard_data.get("overall", [])
    role_winners = leaderboard_data.get("roleWinners", {})
    system_steward = leaderboard_data.get("systemSteward")

    niv_history = system_state.get("nivHistory", [])
    avg_abs_niv = (
        round(sum(e.get("absNiv", 0) for e in niv_history) / len(niv_history))
        if niv_history
        else 0
    )

    return {
        "podium": overall[:3],
        "roleWinners": role_winners,
        "systemSteward": {
            "id": system_steward["id"],
            "name": system_steward["name"],
            "systemScore": system_steward.get("systemScore"),
        } if system_steward else None,
        "systemMetrics": {
            "avgAbsNIV": avg_abs_niv,
            "totalBalancingCost": round(system_state.get("totalBalancingCost", 0)),
            "stressEvents": system_state.get("stressEvents", 0),
            "blackouts": system_state.get("blackouts", 0),
            "totalSPs": system_state.get("totalSPs", 0),
        },
        "narratives": [
            {"id": p["id"], "name": p["name"], "narrative": generate_player_narrative(p)}
            for p in overall[:5]
        ],
    }
