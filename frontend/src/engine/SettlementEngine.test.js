import { describe, it, expect } from "vitest";
import { SP_DURATION_H } from "../shared/constants.js";
import {
  computeImbalance,
  selectImbalancePrice,
  computeImbalanceSettlement,
  computeHubFeeFromSettlements,
} from "./SettlementEngine.js";

describe("SettlementEngine core arithmetic", () => {
  it("uses imbalance = actual − contracted (negative when short)", () => {
    const contracted = 10; // MW
    const actual = 8; // MW
    const imbalance = computeImbalance(actual, contracted, 0);
    expect(imbalance).toBe(actual - contracted);
    expect(imbalance).toBe(-2);
  });

  it("selects SBP when imbalance is negative (short) and SSP when positive (long)", () => {
    const sbp = 100;
    const ssp = 90;
    expect(selectImbalancePrice(-1, sbp, ssp)).toBe(sbp);
    expect(selectImbalancePrice(+1, sbp, ssp)).toBe(ssp);
  });

  it("computes MWh and cash with explicit SP_DURATION_H = 0.5", () => {
    const contracted = 10;
    const actual = 8;
    const sbp = 100;
    const ssp = 90;

    const { imbalanceMw, price, mwh, cash } = computeImbalanceSettlement({
      actualPhysicalMw: actual,
      contractedMw: contracted,
      sbp,
      ssp,
    });

    expect(SP_DURATION_H).toBeCloseTo(0.5, 6);
    expect(imbalanceMw).toBe(actual - contracted); // -2 MW
    expect(price).toBe(sbp); // short → SBP
    expect(mwh).toBeCloseTo(imbalanceMw * SP_DURATION_H, 6); // -1 MWh
    expect(cash).toBeCloseTo(mwh * price, 6); // -£100
  });

  it("handles positive imbalance correctly", () => {
    const contracted = 10;
    const actual = 12;
    const sbp = 100;
    const ssp = 90;

    const { imbalanceMw, price, mwh, cash } = computeImbalanceSettlement({
      actualPhysicalMw: actual,
      contractedMw: contracted,
      sbp,
      ssp,
    });

    expect(imbalanceMw).toBe(2);
    expect(price).toBe(ssp);
    expect(mwh).toBeCloseTo(imbalanceMw * SP_DURATION_H, 6); // 1 MWh
    expect(cash).toBeCloseTo(mwh * price, 6); // +£90
  });

  it("supports negative prices without breaking sign convention", () => {
    const contracted = 10;
    const actual = 8;
    const sbp = -20; // negative SBP
    const ssp = 90;

    const { imbalanceMw, price, mwh, cash } = computeImbalanceSettlement({
      actualPhysicalMw: actual,
      contractedMw: contracted,
      sbp,
      ssp,
    });

    expect(imbalanceMw).toBe(-2);
    expect(price).toBe(sbp);
    expect(mwh).toBeCloseTo(-2 * SP_DURATION_H, 6); // -1 MWh
    expect(cash).toBeCloseTo(mwh * price, 6); // (-1) * (-20) = +£20
    expect(Number.isFinite(price)).toBe(true);
  });

  it("handles long system with negative SBP with correct cash signs", () => {
    const contractedShort = 10;
    const actualShort = 8; // short 2 MW
    const contractedLong = 10;
    const actualLong = 12; // long 2 MW

    const sbp = -20; // negative SBP (system very long)
    const ssp = 30;

    const shortSettle = computeImbalanceSettlement({
      actualPhysicalMw: actualShort,
      contractedMw: contractedShort,
      sbp,
      ssp,
    });
    const longSettle = computeImbalanceSettlement({
      actualPhysicalMw: actualLong,
      contractedMw: contractedLong,
      sbp,
      ssp,
    });

    // Short at negative SBP gets paid
    expect(shortSettle.imbalanceMw).toBe(-2);
    expect(shortSettle.price).toBe(sbp);
    expect(shortSettle.cash).toBeGreaterThan(0);

    // Long side still prices off SSP, formula holds regardless of sign
    expect(longSettle.imbalanceMw).toBe(2);
    expect(longSettle.price).toBe(ssp);
    expect(longSettle.cash).toBeCloseTo(longSettle.mwh * longSettle.price, 6);
  });

  it("computes hub fee as opposite of sum of player imbalance cash (hub-fee model)", () => {
    // Two players, equal and opposite MWh at same price → zero-sum between them,
    // but we still route imbalance through a hub account for audit.
    const p1 = computeImbalanceSettlement({
      actualPhysicalMw: 12,
      contractedMw: 10,
      sbp: 100,
      ssp: 90,
    }); // +2 MW long → SSP

    const p2 = computeImbalanceSettlement({
      actualPhysicalMw: 8,
      contractedMw: 10,
      sbp: 100,
      ssp: 90,
    }); // -2 MW short → SBP

    const settlements = [
      { imbCash: p1.cash },
      { imbCash: p2.cash },
    ];

    const { sumPlayerImbCash, hubFee } = computeHubFeeFromSettlements(settlements);

    // Hub P&L is by definition the opposite of player cashflows
    expect(sumPlayerImbCash + hubFee).toBeCloseTo(0, 6);
  });
});

