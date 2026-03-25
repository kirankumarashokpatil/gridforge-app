import { useRef, useCallback } from "react";

/**
 * useGameEngine: Server-authoritative game loop hook.
 *
 * Two-tier architecture matching real GB market:
 *   Day-level: FORECAST → DA → IDA1 → IDA2 → ID  (all 48 SPs at once)
 *   Real-time: REALTIME → BM_OPEN/BM_CLOSE per SP 1..48
 *   End:       RESULTS → next day
 *
 * All clearing, settlement, and scoring is delegated to the FastAPI backend.
 * This hook translates server responses into local React state updates.
 */
export function useGameEngine(appState, playerRefs, setters, callbacks) {
  const { addToast, apiRef, room } = callbacks;
  const {
    sp, phase, market, players, spContracts, pid, asset: ak, gameMode, role,
    physicalState, cash, contractPosition, orderbookSnap, daOrderbookSnap
  } = appState;

  const {
    setMarket, setCash, setPhysicalState, setSpContracts, setSystemState,
    setPlayerScores, setOverallScoreHistory, setSpHistory, setImbalancePenalty,
    setContractPosition, setDaCash
  } = setters;

  const prevPhaseRef = useRef({ phase: "INIT", sp: 0 });

  // Helper — safely call the engine API, return null on error
  const _call = async (method, ...args) => {
    try {
      const fn = apiRef?.[method];
      if (!fn) { console.warn(`[GameEngine] apiRef.${method} not found`); return null; }
      return await fn(...args);
    } catch (err) {
      console.error(`[GameEngine] ${method} failed:`, err);
      return null;
    }
  };

  /**
   * Handle day-level phase transitions.
   * Called when advancing through: FORECAST → DA → IDA1 → IDA2 → ID → REALTIME
   */
  const handleDayPhaseTransition = useCallback(async (oldPhase, roomId) => {
    const rid = roomId || room;
    if (!rid) return;
    console.log('[GameEngine] handleDayPhaseTransition:', { oldPhase, rid });

    // Server handles all clearing via advance_day_phase.
    // We just need to sync local state from the result.
    const result = await _call('engineAdvanceDayPhase', rid);
    if (!result) return result;

    console.log('[GameEngine] Day phase result:', result);

    // After DA clears all 48 SPs: sync positions
    if (oldPhase === "DA" && result.daResults) {
      let totalDaRev = 0;
      const allResults = result.daResults;
      for (const [spKey, spResult] of Object.entries(allResults)) {
        for (const acc of (spResult.accepted_bids || [])) {
          if (acc.id === pid || acc.player_id === pid) {
            totalDaRev += acc.revenue || 0;
          }
        }
      }
      if (totalDaRev) {
        setCash(prev => prev + totalDaRev);
        setDaCash(prev => prev + totalDaRev);
      }
    }

    // After IDA1/IDA2 clears all SPs: sync cash
    if ((oldPhase === "IDA1" || oldPhase === "IDA2")) {
      const key = `${oldPhase.toLowerCase()}Results`;
      const idaResults = result[key] || {};
      let totalRev = 0;
      for (const [spKey, spResult] of Object.entries(idaResults)) {
        for (const acc of (spResult.accepted_bids || [])) {
          if (acc.id === pid || acc.player_id === pid) {
            totalRev += acc.revenue || 0;
          }
        }
      }
      if (totalRev) setCash(prev => prev + totalRev);
    }

    return result;
  }, [room, pid, setCash, setDaCash]);

  /**
   * Handle BM-level transitions during REALTIME.
   * Called per-SP: BM_OPEN → BM_CLOSE → next SP → ...
   */
  const handleBmAdvance = useCallback(async (roomId) => {
    const rid = roomId || room;
    if (!rid) return;

    const result = await _call('engineAdvanceBm', rid);
    if (!result) return result;

    console.log('[GameEngine] BM advance result:', result);

    // If BM just closed for a SP, sync settlement data
    if (result.settlement) {
      const mySettlement = result.settlement[pid];
      if (mySettlement) {
        setCash(mySettlement.cash ?? cash);
        if (mySettlement.imbalancePenalty < -5) {
          setImbalancePenalty(prev => prev + Math.abs(mySettlement.imbalancePenalty));
        }
      }
    }

    // If BM cleared, sync BM result
    if (result.bmResult) {
      const mine = (result.bmResult.accepted || []).find(
        a => a.id === pid || a.player_id === pid
      );
      if (mine) {
        setCash(prev => prev + (mine.revenue || 0));
      }
    }

    // If day ended (RESULTS phase), sync scores
    if (result.scores) {
      const myScores = result.scores[pid];
      if (myScores) {
        setPlayerScores?.({
          roleScore: myScores.roleScore,
          systemScore: myScores.systemScore,
          overallScore: myScores.overallScore,
        });
        setCash(myScores.cash ?? cash);
      }
    }

    return result;
  }, [room, pid, cash, setCash, setImbalancePenalty, setPlayerScores]);

  /**
   * Legacy phase transition handler — routes to day-level or BM-level.
   * Kept for backward compatibility with existing UI components.
   */
  const handlePhaseTransition = useCallback(async (oldPhase, oldSp, _gun, roomId, isInstructor) => {
    const rid = roomId || room;
    if (!rid) return;
    console.log('[GameEngine] handlePhaseTransition (compat):', { oldPhase, oldSp, rid });

    // Day-level phases
    if (["FORECAST", "FORECAST_0", "FORECAST_1", "FORECAST_2", "DA", "IDA1", "IDA2", "ID", "ID_ROUNDS", "RESULTS"].includes(oldPhase)) {
      return handleDayPhaseTransition(oldPhase, rid);
    }

    // BM phases during REALTIME
    if (oldPhase === "BM_OPEN" || oldPhase === "BM_CLOSE" || oldPhase === "BM_CLEAR" || oldPhase === "SP_SETTLED" || oldPhase === "BM_GATE" || oldPhase === "REALTIME") {
      return handleBmAdvance(rid);
    }

    // Settlement compat
    if (oldPhase === "SETTLEMENT") {
      const settlements = await _call('engineSettle', rid);
      if (settlements) {
        const mySettlement = settlements[pid];
        if (mySettlement) {
          setCash(mySettlement.cash ?? cash);
          if (mySettlement.imbalancePenalty < -5) {
            setImbalancePenalty(prev => prev + Math.abs(mySettlement.imbalancePenalty));
          }
          setPlayerScores?.({
            roleScore: mySettlement.roleScore,
            systemScore: mySettlement.systemScore,
            overallScore: mySettlement.overallScore,
          });
        }
      }
    }
  }, [room, pid, cash, physicalState, handleDayPhaseTransition, handleBmAdvance,
    setMarket, setCash, setDaCash, setContractPosition, setSpContracts,
    setSystemState, setPlayerScores, setImbalancePenalty, addToast]);

  return { handlePhaseTransition, handleDayPhaseTransition, handleBmAdvance, prevPhaseRef };
}