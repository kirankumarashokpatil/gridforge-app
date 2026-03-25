"""
GridForge utilities — Python port of src/shared/utils.js
"""

from __future__ import annotations
import math
import time
import random
import string


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def f0(n: float) -> str:
    return str(round(float(n)))


def f1(n: float) -> str:
    return f"{float(n):.1f}"


def fpp(n: float) -> str:
    sign = "+" if n >= 0 else "-"
    return f"{sign}£{abs(round(float(n)))}"


def sp_time(sp: int) -> str:
    h = ((sp - 1) * 30) // 60 % 24
    m = ((sp - 1) * 30) % 60
    return f"{h:02d}:{m:02d}"


def uid() -> str:
    ts = int(time.time() * 1000)
    rand1 = "".join(random.choices(string.ascii_lowercase + string.digits, k=7))
    rand2 = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
    return f"p_{ts}_{rand1}_{rand2}"


def room_key(room: str, suffix: str) -> str:
    return f"gf_v4_{room.upper()}_{suffix}"
