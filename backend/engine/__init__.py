"""
GridForge Engine — Server-authoritative game logic.

Ported from src/engine/*.js and src/shared/*.js to make the
FastAPI backend the single source of truth for:
  - Market clearing (DA, BM, ID)
  - Settlement / imbalance calculations
  - Scoring (role + system + overall)
  - Asset physics (SoC, fuel, wind/solar)
  - Gate logic & phase management
  - Forecasts
  - Leaderboard & achievements
"""

from .constants import *
