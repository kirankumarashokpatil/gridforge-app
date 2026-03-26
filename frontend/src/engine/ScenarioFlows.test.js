import { describe, it, expect } from "vitest";
import { marketForSp } from "./MarketEngine.js";
import {
  computeImbalanceSettlement,
  computeHubFeeFromSettlements,
} from "./SettlementEngine.js";
import { SP_DURATION_H } from "../shared/constants.js";

// Higher-level scenario-style checks that tie together market, prices,
// and settlement for teaching scenarios (spike, disconnect, etc.)

describe("Scenario flows (spike, disconnect, imbalance)", () => {
  it("SPIKE scenario produces higher SBP than NORMAL for same SP", () => {
    const sp = 12;

    const normal = marketForSp(sp, "NORMAL", []);
    const spike = marketForSp(sp, "SPIKE", []);

    expect(spike.actual.sbp).toBeGreaterThan(normal.actual.sbp);
    expect(spike.actual.sbp).toBeGreaterThan(normal.actual.sbp * 1.2);
  });

  it("under-hedged player in a spike scenario pays a large imbalance charge when short", () => {
    const sp = 15;
    const spike = marketForSp(sp, "SPIKE", []);
    const { sbp } = spike.actual;

    // Player contracted 10 MW but physically delivered 0 MW (generator trip)
    const contractedMw = 10;
    const actualPhysicalMw = 0;

    const { imbalanceMw, price, mwh, cash } = computeImbalanceSettlement({
      actualPhysicalMw,
      contractedMw,
      sbp,
      ssp: spike.actual.ssp,
    });

    expect(imbalanceMw).toBeLessThan(0); // short
    expect(price).toBe(sbp); // SBP applies when short
    expect(mwh).toBeCloseTo(imbalanceMw * SP_DURATION_H, 6);
    expect(cash).toBeLessThan(0); // pays money
    // With SPIKE scenario multipliers, this should be materially large
    expect(Math.abs(cash)).toBeGreaterThan(50);
  });

  it("disconnected player with DA contract and zero BM adjustment settles purely on DA vs actual", () => {
    // Model: player has DA contract but submits no BM bid (treated as zero BM).
    const contractedMw = 20;

    // Actual output is zero (offline or disconnected)
    const actualPhysicalMw = 0;

    // Prices don't matter for the relationship, only for cash magnitude.
    const sbp = 100;
    const ssp = 90;

    const { imbalanceMw, price, mwh, cash } = computeImbalanceSettlement({
      actualPhysicalMw,
      contractedMw,
      sbp,
      ssp,
    });

    expect(imbalanceMw).toBe(-20); // short 20 MW
    expect(price).toBe(sbp);
    expect(mwh).toBeCloseTo(-20 * SP_DURATION_H, 6);
    expect(cash).toBeCloseTo(mwh * price, 6);
  });

  it("hub fee keeps cashflows conserved for a simple spike scenario with two players", () => {
    const sp = 18;
    const spike = marketForSp(sp, "SPIKE", []);
    const { sbp, ssp } = spike.actual;

    // Player A: generator over-delivers relative to contract (long)
    const aSettle = computeImbalanceSettlement({
      actualPhysicalMw: 15,
      contractedMw: 10,
      sbp,
      ssp,
    });

    // Player B: generator under-delivers relative to contract (short)
    const bSettle = computeImbalanceSettlement({
      actualPhysicalMw: 5,
      contractedMw: 10,
      sbp,
      ssp,
    });

    const settlements = [
      { pid: "A", imbCash: aSettle.cash },
      { pid: "B", imbCash: bSettle.cash },
    ];

    const { sumPlayerImbCash, hubFee } =
      computeHubFeeFromSettlements(settlements);

    expect(sumPlayerImbCash + hubFee).toBeCloseTo(0, 6);
  });
});

