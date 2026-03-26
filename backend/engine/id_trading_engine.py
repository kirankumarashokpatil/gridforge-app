"""
GridForge ID Trading Engine — Continuous intraday order-book market.

Models GB EPEX SPOT / Nord Pool intraday:
  - Order-book, pay-as-bid: each trade executes at the aggressor's limit price
  - Per-SP gate closure: trading stops 1 hour before SP delivery
  - Multiple trading rounds between IDA2 and BM
  - Players post limit buy/sell orders for specific SPs
"""

from __future__ import annotations
import time
import random

from .constants import SP_DURATION_H, SPS_PER_DAY
from .utils import sp_time


# ─── GATE CLOSURE TIMING ───

def get_gate_closure_hour(sp: int) -> float:
    if 1 <= sp <= 20:
        return 23 + (sp - 1) * 0.5
    else:
        return 9 + (sp - 21) * 0.5


def get_bm_gate_closure_hour(sp: int) -> float:
    sp_start_hour = ((sp - 1) * 0.5) % 24
    bm_gate_hour = sp_start_hour - 1
    if bm_gate_hour < 0:
        bm_gate_hour += 24
    if sp <= 2:
        return 23 + (sp - 1) * 0.5
    return bm_gate_hour


def format_gate_closure_time(sp: int) -> str:
    hour = get_gate_closure_hour(sp)
    day = "TODAY" if sp <= 20 else "TOMORROW"
    h = int(hour) % 24
    m = int((hour % 1) * 60)
    return f"{h:02d}:{m:02d} {day}"


# ─── GATE STATUS ───

def is_id_gate_open(sp: int, current_time_hour: float) -> bool:
    gate_hour = get_gate_closure_hour(sp)
    if sp > 20:
        return current_time_hour >= 24 and current_time_hour < gate_hour + 24
    return current_time_hour < gate_hour


def get_time_to_gate_closure(sp: int, current_time_hour: float) -> float:
    gate_hour = get_gate_closure_hour(sp)
    if sp > 20:
        return (gate_hour + 24) - current_time_hour
    return gate_hour - current_time_hour


def get_open_sps(current_time_hour: float) -> list[int]:
    return [sp for sp in range(1, 49) if is_id_gate_open(sp, current_time_hour)]


def get_newly_closed_sps(current_time_hour: float, prev_time_hour: float) -> list[int]:
    return [
        sp for sp in range(1, 49)
        if is_id_gate_open(sp, prev_time_hour) and not is_id_gate_open(sp, current_time_hour)
    ]


# ─── ID TRADE STRUCTURE ───

def create_id_trade(sp: int, player_id: str, side: str, volume_mw: float, price: float, timestamp: float) -> dict:
    rand_suffix = "".join(random.choices("abcdefghijklmnopqrstuvwxyz0123456789", k=3))
    return {
        "id": f"id_{int(time.time() * 1000)}_{rand_suffix}",
        "sp": sp,
        "playerId": player_id,
        "side": side,
        "volumeMW": abs(volume_mw),
        "price": price,
        "timestamp": timestamp,
        "status": "pending",
    }


# ─── POSITION TRACKING ───

def calculate_positions(da_volumes: list[float], id_trades: list[dict], player_id: str) -> list[dict]:
    positions = []
    for sp in range(1, 49):
        da_vol = da_volumes[sp - 1] if sp - 1 < len(da_volumes) else 0
        sp_trades = [t for t in id_trades if t["sp"] == sp and t["playerId"] == player_id and t.get("status") == "confirmed"]

        id_buy_vol = sum(t["volumeMW"] for t in sp_trades if t["side"] == "buy")
        id_sell_vol = sum(t["volumeMW"] for t in sp_trades if t["side"] == "sell")

        net_position = da_vol + id_buy_vol - id_sell_vol

        positions.append({
            "sp": sp,
            "daVolume": da_vol,
            "idBuyVolume": id_buy_vol,
            "idSellVolume": id_sell_vol,
            "netPosition": net_position,
            "trades": sp_trades,
            "isOpen": True,
        })
    return positions


# ─── ID MARKET CLEARING ───

def match_id_orders(buy_orders: list[dict], sell_orders: list[dict]) -> list[dict]:
    """
    Order-book matching with pay-as-bid pricing.

    Sorts buys descending by price, sells ascending.  Walks the book:
    when best-buy >= best-sell, a trade occurs at the **earlier** order's
    price (i.e. the passive/resting side).  This is standard exchange
    convention — the aggressor (later order) gets the resting price.

    For the game we simplify: use the sell price for the trade
    (seller sets the floor, buyer pays that floor if willing).
    """
    matches = []
    sorted_buys = sorted(buy_orders, key=lambda b: b["price"], reverse=True)
    sorted_sells = sorted(sell_orders, key=lambda s: s["price"])

    si = 0
    for buy in sorted_buys:
        while si < len(sorted_sells):
            sell = sorted_sells[si]
            if buy["price"] < sell["price"]:
                break  # no more matchable sells
            if buy.get("volumeMW", buy.get("mw", 0)) <= 0:
                break
            if sell.get("volumeMW", sell.get("mw", 0)) <= 0:
                si += 1
                continue

            buy_vol = buy.get("volumeMW", buy.get("mw", 0))
            sell_vol = sell.get("volumeMW", sell.get("mw", 0))
            match_volume = min(buy_vol, sell_vol)

            # Pay-as-bid: trade at the passive (sell) side price
            match_price = sell["price"]

            matches.append({
                "sp": buy.get("sp", sell.get("sp")),
                "buyerId": buy.get("playerId", buy.get("id")),
                "sellerId": sell.get("playerId", sell.get("id")),
                "volumeMW": match_volume,
                "price": round(match_price, 2),
                "buyerPays": round(match_volume * match_price * SP_DURATION_H, 2),
                "sellerReceives": round(match_volume * match_price * SP_DURATION_H, 2),
            })

            # Reduce residual volume
            if "volumeMW" in buy:
                buy["volumeMW"] -= match_volume
            else:
                buy["mw"] = buy.get("mw", 0) - match_volume
            if "volumeMW" in sell:
                sell["volumeMW"] -= match_volume
            else:
                sell["mw"] = sell.get("mw", 0) - match_volume

            if sell.get("volumeMW", sell.get("mw", 0)) <= 0:
                si += 1

    return matches


# ─── CLEAR A FULL ID ROUND (all open SPs) ───

def clear_id_round(
    orders_by_player: dict,
    open_sps: list[int] | None = None,
) -> dict:
    """
    Run one round of continuous ID clearing across all open SPs.

    orders_by_player: { pid: [ { sp, side, mw, price }, ... ] }
    open_sps: list of SPs still open for trading (None = all 48)

    Returns:
      {
        "trades": [ { sp, buyerId, sellerId, volumeMW, price, ... } ],
        "tradesBySp": { sp: [...] },
        "totalVolume": float,
        "positionDeltas": { pid: { sp: delta_mw } },
        "cashDeltas": { pid: float },
      }
    """
    if open_sps is None:
        open_sps = list(range(1, SPS_PER_DAY + 1))
    open_set = set(open_sps)

    # Bucket orders by SP
    buys_by_sp: dict[int, list] = {}
    sells_by_sp: dict[int, list] = {}

    for pid, orders in orders_by_player.items():
        if not isinstance(orders, list):
            orders = [orders]
        for order in orders:
            sp = order.get("sp")
            if sp is None or sp not in open_set:
                continue
            entry = {
                **order,
                "playerId": pid,
                "volumeMW": float(order.get("mw", order.get("volumeMW", 0))),
            }
            side = order.get("side", "").lower()
            if side in ("buy", "bid"):
                buys_by_sp.setdefault(sp, []).append(entry)
            elif side in ("sell", "offer"):
                sells_by_sp.setdefault(sp, []).append(entry)

    all_trades = []
    trades_by_sp: dict[int, list] = {}
    pos_deltas: dict[str, dict[int, float]] = {}  # pid → { sp → MW delta }
    cash_deltas: dict[str, float] = {}  # pid → £ delta

    for sp in open_sps:
        sp_buys = buys_by_sp.get(sp, [])
        sp_sells = sells_by_sp.get(sp, [])
        if not sp_buys or not sp_sells:
            continue

        sp_trades = match_id_orders(sp_buys, sp_sells)
        if not sp_trades:
            continue

        all_trades.extend(sp_trades)
        trades_by_sp[sp] = sp_trades

        for t in sp_trades:
            vol = t["volumeMW"]
            payment = t.get("buyerPays", vol * t["price"] * SP_DURATION_H)

            # Buyer: increases position (buys power), pays cash
            buyer = t["buyerId"]
            pos_deltas.setdefault(buyer, {})[sp] = (
                pos_deltas.get(buyer, {}).get(sp, 0) - vol
            )
            cash_deltas[buyer] = cash_deltas.get(buyer, 0) - payment

            # Seller: decreases position (sells power), receives cash
            seller = t["sellerId"]
            pos_deltas.setdefault(seller, {})[sp] = (
                pos_deltas.get(seller, {}).get(sp, 0) + vol
            )
            cash_deltas[seller] = cash_deltas.get(seller, 0) + payment

    return {
        "trades": all_trades,
        "tradesBySp": trades_by_sp,
        "totalVolume": sum(t["volumeMW"] for t in all_trades),
        "positionDeltas": pos_deltas,
        "cashDeltas": cash_deltas,
    }


# ─── UI HELPERS ───

def get_gate_status_display(sp: int, current_time_hour: float) -> dict:
    is_open = is_id_gate_open(sp, current_time_hour)
    hours_remaining = get_time_to_gate_closure(sp, current_time_hour)

    if not is_open:
        return {"status": "closed", "message": "LOCKED - No more ID trades", "color": "#f0455a", "canTrade": False}

    if hours_remaining <= 0.5:
        return {"status": "urgent", "message": f"{round(hours_remaining * 60)}m left - URGENT", "color": "#f5b222", "canTrade": True}

    if hours_remaining <= 2:
        return {"status": "warning", "message": f"{round(hours_remaining * 10) / 10}h left", "color": "#fb923c", "canTrade": True}

    return {"status": "open", "message": f"{round(hours_remaining * 10) / 10}h left", "color": "#1de98b", "canTrade": True}


def format_position(position: float) -> dict:
    if position == 0:
        return {"text": "FLAT", "color": "#64748b", "emoji": "➖"}
    if position > 0:
        return {"text": f"LONG {position:.1f}MW", "color": "#38c0fc", "emoji": "📈"}
    return {"text": f"SHORT {abs(position):.1f}MW", "color": "#f0455a", "emoji": "📉"}


# ─── PHASE MANAGEMENT ───

PHASES = {
    "DA": "DA",
    "ID": "ID",
    "BM_GATE": "BM_GATE",
    "DELIVERY": "DELIVERY",
    "SETTLEMENT": "SETTLEMENT",
}

PHASE_DISPLAY_NAMES = {
    "DA": "Day-Ahead Auction",
    "ID": "Intraday Trading",
    "BM_GATE": "BM Gate Closed",
    "DELIVERY": "Live Delivery",
    "SETTLEMENT": "Settlement",
}


def get_phase_from_time(current_time_hour: float) -> str:
    if current_time_hour < 2:
        return PHASES["DA"]
    if current_time_hour < 23:
        return PHASES["ID"]
    return PHASES["ID"]


# ─── DA AUCTION TIMING ───

DA_AUCTION_TIMES = [9.33, 15.5]


def get_next_da_auction(current_time_hour: float) -> float:
    for t in DA_AUCTION_TIMES:
        if current_time_hour < t:
            return t
    return DA_AUCTION_TIMES[0] + 24


def is_da_auction_open(current_time_hour: float) -> bool:
    is_hourly = 8 <= current_time_hour < 9.33
    is_half_hourly = 14 <= current_time_hour < 15.5
    return is_hourly or is_half_hourly
