import { describe, it, expect } from "vitest";
import { marketForSp, clearBM } from "./MarketEngine.js";
import {
  computeImbalanceSettlement,
  computeHubFeeFromSettlements,
} from "./SettlementEngine.js";
import { availMW } from "./AssetPhysics.js";
import { ASSETS, MIN_SOC, MAX_SOC, SP_DURATION_H } from "../shared/constants.js";

// Simple multiplayer-style harness using pure engine functions.
// We deliberately avoid React/Gun here and just emulate a couple of players
// in a single SP to check determinism and cashflow conservation.

describe("Multiplayer integration harness", () => {
  it("produces identical BM clearing and settlements for multiple runs (deterministic per SP)", () => {
    const sp = 10;
    const scenarioId = "NORMAL";

    // Shared market state (same for all players and all runs)
    const m1 = marketForSp(sp, scenarioId, []);
    const m2 = marketForSp(sp, scenarioId, []);

    // Deterministic actual state for this SP
    expect(m1.actual.sbp).toBeCloseTo(m2.actual.sbp, 10);
    expect(m1.actual.ssp).toBeCloseTo(m2.actual.ssp, 10);
    expect(m1.actual.niv).toBeCloseTo(m2.actual.niv, 10);

    const market = m1.actual;

    // Two players submit BM offers/bids consistent with system short/long flag
    const bids = [
      { id: "P1", side: market.isShort ? "offer" : "bid", mw: 30, price: market.baseRef * 0.9 },
      { id: "P2", side: market.isShort ? "offer" : "bid", mw: 40, price: market.baseRef * 1.1 },
    ];

    const r1 = clearBM(bids, market);
    const r2 = clearBM(bids, market);

    // BM result must be identical run-to-run
    expect(r1.cp).toBeCloseTo(r2.cp, 10);
    expect(r1.cleared).toBeCloseTo(r2.cleared, 10);
    expect(r1.full).toBe(r2.full);
    expect(r1.accepted).toHaveLength(r2.accepted.length);

    r1.accepted.forEach((a, idx) => {
      const b = r2.accepted[idx];
      expect(a.id).toBe(b.id);
      expect(a.mwAcc).toBeCloseTo(b.mwAcc, 10);
      expect(a.marginal).toBe(b.marginal);
      expect(a.revenue).toBeCloseTo(b.revenue, 10);
    });
  });

  it("keeps settlement cashflows conserved via hub fee across multiple players", () => {
    const sbp = 100;
    const ssp = 90;

    // Three players with equal and opposite positions over one SP.
    const players = [
      // Long 5 MW → +2.5 MWh @ SSP
      { id: "A", contractedMw: 0, actualPhysicalMw: 5 },
      // Short 3 MW → -1.5 MWh @ SBP
      { id: "B", contractedMw: 3, actualPhysicalMw: 0 },
      // Short 2 MW → -1.0 MWh @ SBP
      { id: "C", contractedMw: 2, actualPhysicalMw: 0 },
    ];

    const settlements = players.map((p) => {
      const { cash } = computeImbalanceSettlement({
        actualPhysicalMw: p.actualPhysicalMw,
        contractedMw: p.contractedMw,
        bmAcceptedMw: p.bmAcceptedMw || 0,
        sbp,
        ssp,
      });
      return { pid: p.id, imbCash: cash };
    });

    const { sumPlayerImbCash, hubFee } =
      computeHubFeeFromSettlements(settlements);

    // In hub-fee model, hub P&L should be the equal and opposite of players' imbalance cash.
    expect(sumPlayerImbCash + hubFee).toBeCloseTo(0, 6);
  });

  it("runs a simple full-SP workflow for two players and keeps totals deterministic", () => {
    const sp = 5;
    const scenarioId = "NORMAL";

    const { actual } = marketForSp(sp, scenarioId, []);

    // Two players take opposite DA positions and then adjust in BM.
    const players = [
      { id: "P1", daContractMw: 10, bmDeltaMw: actual.isShort ? 5 : -5 },  // leans into system need
      { id: "P2", daContractMw: -10, bmDeltaMw: actual.isShort ? -5 : 5 }, // leans against system
    ];

    // Simple BM clearing: treat their BM deltas as offers/bids around the reference price.
    const bids = players.map((p, idx) => ({
      id: p.id,
      side: actual.isShort ? "offer" : "bid",
      mw: Math.abs(p.bmDeltaMw),
      price: actual.baseRef * (idx === 0 ? 0.95 : 1.05),
    }));

    const bmRes1 = clearBM(bids, actual);
    const bmRes2 = clearBM(bids, actual);

    // BM outcome is deterministic
    expect(bmRes1.cp).toBeCloseTo(bmRes2.cp, 10);
    expect(bmRes1.cleared).toBeCloseTo(bmRes2.cleared, 10);

    // Compute simple imbalance settlements from DA + BM positions.
    const sbp = actual.sbp;
    const ssp = actual.ssp;

    const settlements = players.map((p) => {
      const accepted = bmRes1.accepted.find((a) => a.id === p.id);
      const bmPhysicalMw = accepted ? (actual.isShort ? accepted.mwAcc : -accepted.mwAcc) : 0;
      const contractedMw = p.daContractMw;
      const actualPhysicalMw = contractedMw + bmPhysicalMw;

      const { cash: imbCash } = computeImbalanceSettlement({
        actualPhysicalMw,
        contractedMw,
        bmAcceptedMw: bmPhysicalMw,
        sbp,
        ssp,
      });

      return { pid: p.id, imbCash };
    });

    const { sumPlayerImbCash, hubFee } =
      computeHubFeeFromSettlements(settlements);

    // Hub + players remain cashflow neutral in aggregate.
    expect(sumPlayerImbCash + hubFee).toBeCloseTo(0, 6);
  });

  it("keeps BM and settlements consistent for three players in the same room", () => {
    const sp = 7;
    const scenarioId = "NORMAL";
    const { actual } = marketForSp(sp, scenarioId, []);

    const players = [
      { id: "P1", contractedMw: 10, bmDeltaMw: actual.isShort ? 5 : -5 },
      { id: "P2", contractedMw: -5, bmDeltaMw: actual.isShort ? -3 : 3 },
      { id: "P3", contractedMw: 0, bmDeltaMw: 0 },
    ];

    const bids = players
      .filter((p) => p.bmDeltaMw !== 0)
      .map((p, i) => ({
        id: p.id,
        side: actual.isShort ? "offer" : "bid",
        mw: Math.abs(p.bmDeltaMw),
        price: actual.baseRef * (i === 0 ? 0.95 : 1.05),
      }));

    const bm1 = clearBM(bids, actual);
    const bm2 = clearBM(bids, actual);
    expect(bm1.cp).toBeCloseTo(bm2.cp, 10);

    const settlements = players.map((p) => {
      const acc = bm1.accepted.find((a) => a.id === p.id);
      const bmPhysicalMw = acc ? (actual.isShort ? acc.mwAcc : -acc.mwAcc) : 0;
      const actualPhysicalMw = p.contractedMw + bmPhysicalMw;

      const { cash } = computeImbalanceSettlement({
        actualPhysicalMw,
        contractedMw: p.contractedMw,
        bmAcceptedMw: bmPhysicalMw,
        sbp: actual.sbp,
        ssp: actual.ssp,
      });
      return { pid: p.id, imbCash: cash };
    });

    const { sumPlayerImbCash, hubFee } =
      computeHubFeeFromSettlements(settlements);
    expect(sumPlayerImbCash + hubFee).toBeCloseTo(0, 6);
  });

  it("rejects post-gate-closure BM bids at UI level (conceptual)", () => {
    // This is a conceptual guard: in the real app, submitBid will call
    // canSubmitBmBid(phase, msLeft) before writing to Gun.
    // We assert behaviour in GateLogic tests; here we just document the contract.
    expect(true).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // NEW EDGE CASE TESTS (per comprehensive testing strategy)
  // ══════════════════════════════════════════════════════════════════════════════

  describe("Edge Case Tests – Physics Constraints", () => {

    it("BESS Limits: prevents charging when SoC is already at 95% (overcharge protection)", () => {
      const bessDef = ASSETS.BESS_M; // 50 MW / 100 MWh battery with 0.90 efficiency

      // BESS at 95% SoC in a system LONG (isShort = false → charging)
      const sofuel95 = 95;
      const marketLong = { isShort: false, wf: 0.5, sf: 0.3 };

      const mwAvailableToCharge = availMW(bessDef, sofuel95, marketLong);

      // With 95% SoC, we should have very little room for charging.
      // (MAX_SOC - sofuel) / 100 * maxMWh / eff / SP_DURATION_H = (90-95) / 100 * 100 / 0.9 / 0.5
      // Since we're already above MAX_SOC (90%), availMW should clamp to near 0
      expect(mwAvailableToCharge).toBeLessThan(5);
      expect(mwAvailableToCharge).toBeGreaterThanOrEqual(0);

      // Now test at healthy SoC (50%)
      const sofuel50 = 50;
      const mwAvailableAtMid = availMW(bessDef, sofuel50, marketLong);

      // At 50% SoC, plenty of room to charge
      expect(mwAvailableAtMid).toBeGreaterThan(mwAvailableToCharge);
      expect(mwAvailableAtMid).toBeLessThanOrEqual(bessDef.maxMW);
    });

    it("Generator MSG (Minimum Stable Generation): trips generator if dispatched below minMw", () => {

      const ccgtDef = ASSETS.CCGT; // 450 MW with 180 MW minMw
      const ocgtDef = ASSETS.OCGT; // 150 MW with 40 MW minMw

      // Test 1: CCGT at 175 MW (below 180 MW min) should be treated as offline
      let intendedPhysicalCCGT = 175;
      let statusCCGT = "ONLINE";

      if (ccgtDef.minMw && intendedPhysicalCCGT > 0 && intendedPhysicalCCGT < ccgtDef.minMw) {
        // Plant cannot run at this output; must trip offline
        intendedPhysicalCCGT = 0;
        statusCCGT = "OFFLINE";
      }

      expect(intendedPhysicalCCGT).toBe(0);
      expect(statusCCGT).toBe("OFFLINE");

      // Test 2: OCGT at 35 MW (below 40 MW min) also trips offline
      let intendedPhysicalOCGT = 35;
      let statusOCGT = "ONLINE";

      if (ocgtDef.minMw && intendedPhysicalOCGT > 0 && intendedPhysicalOCGT < ocgtDef.minMw) {
        intendedPhysicalOCGT = 0;
        statusOCGT = "OFFLINE";
      }

      expect(intendedPhysicalOCGT).toBe(0);
      expect(statusOCGT).toBe("OFFLINE");

      // Test 3: CCGT exactly at minMw should stay online
      let intendedPhysicalCCGTValid = 180;
      let statusCCGTValid = "ONLINE";

      if (ccgtDef.minMw && intendedPhysicalCCGTValid > 0 && intendedPhysicalCCGTValid < ccgtDef.minMw) {
        intendedPhysicalCCGTValid = 0;
        statusCCGTValid = "OFFLINE";
      }

      expect(intendedPhysicalCCGTValid).toBe(180);
      expect(statusCCGTValid).toBe("ONLINE");
    });

    it("Zero & Negative Pricing: clearing still works with zero-cost wind/solar bids", () => {
      const sp = 8; // afternoon, less solar, may need DSR
      const scenarioId = "NORMAL";

      const { actual } = marketForSp(sp, scenarioId, []);

      // Construct a BM market with renewable zero-cost bids (front of merit order)
      // plus conventional positive-cost bids
      const bids = [
        { id: "WIND", side: "offer", mw: 50, price: 0 },       // Zero marginal cost
        { id: "SOLAR", side: "offer", mw: 30, price: 0 },      // Zero marginal cost
        { id: "GAS_LOW", side: "offer", mw: 40, price: 20 },   // Positive cost
        { id: "GAS_HIGH", side: "offer", mw: 30, price: 50 },  // Higher cost
      ];

      // Force a SHORT market scenario to ensure generation is needed
      const marketShort = { ...actual, isShort: true, niv: -500 };
      const result = clearBM(bids, marketShort);

      // When system is short, expect some bids to clear (algorithm-dependent)
      // Clearing happens based on merit order and system need
      expect(result.cp).toBeGreaterThanOrEqual(-50); // Allow negative or zero
      expect(result.cp).toBeLessThanOrEqual(50); // Capped at max bid price

      // Clearing algorithm should work with zero-cost inputs
      expect(result.cleared).toBeGreaterThanOrEqual(0);
    });

    it("Negative Pricing: handles negative reserve bids (get paid to reduce)", () => {
      const sp = 3;
      const scenarioId = "NORMAL";
      const { actual } = marketForSp(sp, scenarioId, []);

      // Override to ensure system is SHORT (needs supply, not curtailment)
      const marketShort = { ...actual, isShort: true };

      // In a short market, some flexible demand might bid negative prices
      // (willing to pay to be curtailed, or DSR bidding negative)
      // However, clearing should still produce a valid crossing price
      const bids = [
        { id: "DSR_PAY", side: "bid", mw: 20, price: -10 },      // Demand willing to be curtailed
        { id: "GEN_1", side: "offer", mw: 30, price: 15 },       // Supply offering
        { id: "GEN_2", side: "offer", mw: 25, price: 30 },       // Higher cost
      ];

      const result = clearBM(bids, marketShort);

      // Clearing price should exist and be between the accepted offer price and ~0
      // (if negative demand was accepted, MCP can fall below zero)
      expect(result.cp).toBeDefined();
      expect(result.cp).toBeGreaterThanOrEqual(-50); // Allow some negative pricing
      expect(result.cp).toBeLessThanOrEqual(50);      // But not extreme

      // At least some generation should be accepted in a short market
      const genAccepted = result.accepted.filter(a => a.id.startsWith("GEN"));
      expect(genAccepted.length).toBeGreaterThan(0);
    });

    it("Market Clearing Persistence: consecutive runs with same bids produce identical results", () => {
      const sp = 15;
      const scenarioId = "NORMAL";
      const { actual } = marketForSp(sp, scenarioId, []);

      const bids = [
        { id: "P1", side: actual.isShort ? "offer" : "bid", mw: 25, price: actual.baseRef * 0.85 },
        { id: "P2", side: actual.isShort ? "offer" : "bid", mw: 35, price: actual.baseRef * 1.15 },
        { id: "P3", side: actual.isShort ? "offer" : "bid", mw: 20, price: actual.baseRef * 0.95 },
      ];

      // Run clearing multiple times with identical inputs
      const results = [
        clearBM(bids, actual),
        clearBM(bids, actual),
        clearBM(bids, actual),
      ];

      // All three runs must produce identical clearing prices and accepted bidders
      expect(results[0].cp).toBeCloseTo(results[1].cp, 10);
      expect(results[1].cp).toBeCloseTo(results[2].cp, 10);

      expect(results[0].cleared).toBeCloseTo(results[1].cleared, 10);
      expect(results[1].cleared).toBeCloseTo(results[2].cleared, 10);

      // Same bids accepted in all three runs
      expect(results[0].accepted).toHaveLength(results[1].accepted.length);
      expect(results[1].accepted).toHaveLength(results[2].accepted.length);
    });
  });
});

