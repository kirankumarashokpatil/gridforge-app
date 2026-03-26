"""
GridForge Forecast Engine — Python port of src/engine/ForecastEngine.js

Handles generation and publication of standard GB electricity market forecasts.
Models Demand, Wind, and Solar over 48 Settlement Periods (SPs).
Supports modes: manual, auto, mixed.
"""

from __future__ import annotations
import random
import math
from datetime import datetime


class ForecastVersion:
    def __init__(self, author: str, mode: str, demand: list[float], wind: list[float],
                 solar: list[float], confidence: list[float] | None = None, note: str = ""):
        self.id = f"v{int(datetime.now().timestamp() * 1000)}"
        self.author = author
        self.mode = mode
        self.timestamp = datetime.now().isoformat()
        self.demand = demand or [0.0] * 48
        self.wind = wind or [0.0] * 48
        self.solar = solar or [0.0] * 48
        self.confidence = confidence or [0.0] * 48
        self.note = note

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "author": self.author,
            "mode": self.mode,
            "timestamp": self.timestamp,
            "demand": self.demand,
            "wind": self.wind,
            "solar": self.solar,
            "confidence": self.confidence,
            "note": self.note,
        }


class ForecastEngine:
    def __init__(self, sp_per_day: int = 48, seed: int | None = None):
        self.sp_per_day = sp_per_day
        self.seed = seed  # stored so callers can persist + restore for determinism
        self._rng = random.Random(seed)  # isolated PRNG — never touches global random state
        self.published: ForecastVersion | None = None
        self.history: list[ForecastVersion] = []
        self.mode = "auto"
        self.manual_lock = False
        self.skill_level = 0.9

        self.params = {
            "base_demand": 35000,
            "peak_multiplier": 1.3,
            "wind_capacity": 25000,
            "solar_capacity": 15000,
            "noise_level": 0.03,
        }

    def set_mode(self, new_mode: str) -> None:
        if new_mode in ("manual", "auto", "mixed"):
            self.mode = new_mode
            self.manual_lock = new_mode == "manual"

    def create_manual(self, author: str, demand_ts: list[float], wind_ts: list[float],
                      solar_ts: list[float], confidence_ts: list[float] | None = None,
                      note: str = "") -> ForecastVersion:
        if self.mode == "mixed":
            self.manual_lock = True

        version = ForecastVersion(
            author=author,
            mode="manual",
            demand=demand_ts,
            wind=wind_ts,
            solar=solar_ts,
            confidence=confidence_ts or self._default_confidence(demand_ts),
            note=note,
        )
        self._publish(version)
        return version

    def auto_generate(self, noise_multiplier: float = 1.0) -> ForecastVersion:
        demand = self._model_demand(noise_multiplier)
        wind = self._model_wind(noise_multiplier)
        solar = self._model_solar(noise_multiplier)
        confidence = [round(d * self.params["noise_level"] * (1.1 - self.skill_level), 1) for d in demand]

        version = ForecastVersion(
            author="NESO_AI",
            mode="auto",
            demand=demand,
            wind=wind,
            solar=solar,
            confidence=confidence,
            note="Auto-generated DA forecast",
        )
        self._publish(version)
        return version

    def inject_shock(self, shock_type: str, modifier_pct: float) -> ForecastVersion | None:
        if not self.published:
            return None

        new_demand = list(self.published.demand)
        new_wind = list(self.published.wind)
        new_solar = list(self.published.solar)

        for i in range(self.sp_per_day):
            if shock_type == "wind_drop":
                new_wind[i] *= (1 + modifier_pct)
            if shock_type == "demand_spike":
                new_demand[i] *= (1 + modifier_pct)

        version = ForecastVersion(
            author="Instructor (System Override)",
            mode="manual",
            demand=new_demand,
            wind=new_wind,
            solar=new_solar,
            confidence=list(self.published.confidence),
            note=f"SYSTEM SHOCK: {shock_type}",
        )
        self._publish(version)
        return version

    def get_version(self, version_id: str) -> ForecastVersion | None:
        return next((v for v in self.history if v.id == version_id), None)

    def generate_initial_draft(self, current_sp: int = 1) -> dict:
        return {
            "demand": self._model_demand(1.0),
            "wind": self._model_wind(1.0),
            "solar": self._model_solar(1.0),
            "margin": [4000.0] * 48,
        }

    def _publish(self, version: ForecastVersion) -> None:
        self.published = version
        self.history.append(version)
        if len(self.history) > 50:
            self.history.pop(0)

    def _model_demand(self, noise_mult: float) -> list[float]:
        curve = []
        for sp in range(self.sp_per_day):
            val = self.params["base_demand"]
            hour = sp / 2
            if 7 <= hour <= 9:
                val *= 1.15
            if 17 <= hour <= 19:
                val *= self.params["peak_multiplier"]
            if 0 <= hour <= 5:
                val *= 0.7
            noise = 1 + (self._rng.random() - 0.5) * self.params["noise_level"] * noise_mult
            curve.append(round(val * noise, 1))
        return curve

    def _model_wind(self, noise_mult: float) -> list[float]:
        curve = []
        current_yield = 0.4 + self._rng.random() * 0.2
        for sp in range(self.sp_per_day):
            current_yield += (self._rng.random() - 0.5) * 0.1 * noise_mult
            current_yield = max(0, min(1, current_yield))
            curve.append(round(self.params["wind_capacity"] * current_yield, 1))
        return curve

    def _model_solar(self, noise_mult: float) -> list[float]:
        curve = []
        for sp in range(self.sp_per_day):
            hour = sp / 2
            val = 0.0
            if 6 < hour < 18:
                dist = abs(12 - hour)
                val = max(0, 1 - dist / 6)
            noise = 1 + (self._rng.random() - 0.5) * self.params["noise_level"] * 2 * noise_mult
            curve.append(round(self.params["solar_capacity"] * val * noise, 1))
        return curve

    def _default_confidence(self, demand: list[float]) -> list[float]:
        return [round(d * self.params["noise_level"], 1) for d in demand]
