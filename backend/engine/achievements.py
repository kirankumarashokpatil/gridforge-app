"""
GridForge Achievements — Python port of src/engine/Achievements.js

Achievement definitions, stat building, and checking logic.
"""

from __future__ import annotations

from .constants import MIN_SOC, MAX_SOC


ACHIEVEMENTS = [
    # BM mastery
    {"id": "FIRST_CLEAR", "name": "First Blood", "desc": "Get your first bid accepted in the BM",
     "check": lambda s: s.get("totalAccepted", 0) >= 1},
    {"id": "STREAK_5", "name": "Hot Streak", "desc": "5 consecutive accepted bids",
     "check": lambda s: s.get("streak", 0) >= 5},
    {"id": "STREAK_10", "name": "Unstoppable", "desc": "10 consecutive accepted bids",
     "check": lambda s: s.get("streak", 0) >= 10},
    # Revenue milestones
    {"id": "EARN_500", "name": "Profitable Trader", "desc": "Earn £500 total revenue",
     "check": lambda s: s.get("totalRevenue", 0) >= 500},
    {"id": "EARN_2000", "name": "Market Maker", "desc": "Earn £2,000 total revenue",
     "check": lambda s: s.get("totalRevenue", 0) >= 2000},
    {"id": "EARN_5000", "name": "Whale", "desc": "Earn £5,000 total revenue",
     "check": lambda s: s.get("totalRevenue", 0) >= 5000},
    # Asset-specific
    {"id": "BATTERY_MASTER", "name": "Battery Master", "desc": "Operate a battery through 10+ SPs without hitting SoC limits",
     "check": lambda s: s.get("assetKind") == "soc" and s.get("totalSPs", 0) >= 10 and not s.get("hitSoCLimit")},
    {"id": "WIND_WHISPERER", "name": "Wind Whisperer", "desc": "Earn £1,000+ with a wind farm",
     "check": lambda s: s.get("assetKey") == "WIND" and s.get("totalRevenue", 0) >= 1000},
    {"id": "GAS_KING", "name": "Scarcity Shark", "desc": "Earn £500+ in a single SP with OCGT",
     "check": lambda s: s.get("assetKey") == "OCGT" and s.get("bestSingleSP", 0) >= 500},
    {"id": "FLEX_LORD", "name": "Flex Lord", "desc": "Accept 15+ bids with DSR",
     "check": lambda s: s.get("assetKey") == "DSR" and s.get("totalAccepted", 0) >= 15},
    # Scenario-specific
    {"id": "SURVIVE_DUNKEL", "name": "Dark Survivor", "desc": "Stay profitable during Dunkelflaute",
     "check": lambda s: s.get("scenario") == "DUNKELFLAUTE" and s.get("totalRevenue", 0) > 0},
    {"id": "SPIKE_RIDER", "name": "Spike Rider", "desc": "Earn £1,000+ during a Scarcity Event scenario",
     "check": lambda s: s.get("scenario") == "SPIKE" and s.get("totalRevenue", 0) >= 1000},
    # DA market
    {"id": "DA_WINNER", "name": "Forward Thinker", "desc": "Earn £500+ from Day-Ahead auctions",
     "check": lambda s: s.get("daCash", 0) >= 500},
    # Strategic
    {"id": "PERFECT_TIMING", "name": "Perfect Timing", "desc": "Buy low and sell high within 3 SPs",
     "check": lambda s: s.get("hadBuySellFlip", False)},
    {"id": "SURVIVOR", "name": "Grid Guardian", "desc": "Play 20+ SPs without triggering frequency breach",
     "check": lambda s: s.get("totalSPs", 0) >= 20 and not s.get("hadFreqBreach")},
]


def build_achievement_stats(data: dict) -> dict:
    sp_history = data.get("spHistory", [])
    cash = data.get("cash", 0)
    da_cash = data.get("daCash", 0)
    asset_key = data.get("assetKey", "")
    asset_kind = data.get("assetKind", "")
    scenario = data.get("scenario", "")
    soc = data.get("soc", 50)
    freq_breach_sec = data.get("freqBreachSec", 0)

    total_sps = len(sp_history)
    accepted = [h for h in sp_history if h.get("accepted")]
    total_accepted = len(accepted)
    total_revenue = cash
    best_single_sp = max((h.get("revenue", 0) for h in accepted), default=0)

    streak = 0
    for h in reversed(sp_history):
        if h.get("accepted"):
            streak += 1
        else:
            break

    hit_soc_limit = soc <= (MIN_SOC + 1) or soc >= (MAX_SOC - 1)

    had_buy_sell_flip = (
        len(sp_history) >= 3
        and any(h.get("accepted") and not h.get("isShort") for h in sp_history[-3:])
        and any(h.get("accepted") and h.get("isShort") for h in sp_history[-3:])
    )

    return {
        "totalSPs": total_sps,
        "totalAccepted": total_accepted,
        "totalRevenue": total_revenue,
        "bestSingleSP": best_single_sp,
        "streak": streak,
        "assetKey": asset_key,
        "assetKind": asset_kind,
        "scenario": scenario,
        "daCash": da_cash,
        "soc": soc,
        "hitSoCLimit": hit_soc_limit,
        "hadBuySellFlip": had_buy_sell_flip,
        "hadFreqBreach": freq_breach_sec > 0,
    }


def check_achievements(stats: dict, already_earned: list[str]) -> list[dict]:
    newly_earned = []
    for a in ACHIEVEMENTS:
        if a["id"] in already_earned:
            continue
        try:
            if a["check"](stats):
                newly_earned.append(a)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning(
                "Achievement check %s failed: %s", a["id"], exc
            )
    return newly_earned
