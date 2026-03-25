import { describe, it, expect } from "vitest";
import { marketForSp, clearBM } from "./MarketEngine.js";

describe("MarketEngine determinism & BM clearing", () => {
  it("produces deterministic market state for same SP and scenario", () => {
    const s1 = marketForSp(10, "NORMAL", []);
    const s2 = marketForSp(10, "NORMAL", []);

    expect(s1.forecast.sbp).toBeCloseTo(s2.forecast.sbp, 10);
    expect(s1.forecast.ssp).toBeCloseTo(s2.forecast.ssp, 10);
    expect(s1.actual.sbp).toBeCloseTo(s2.actual.sbp, 10);
    expect(s1.actual.ssp).toBeCloseTo(s2.actual.ssp, 10);
    expect(s1.actual.niv).toBeCloseTo(s2.actual.niv, 10);
  });

  it('includes a demandCurve array in both forecast and actual with non‑zero volumes', () => {
    const s = marketForSp(20);
    expect(Array.isArray(s.forecast.demandCurve)).toBe(true);
    expect(Array.isArray(s.actual.demandCurve)).toBe(true);
    expect(s.forecast.demandCurve.length).toBeGreaterThan(1);
    // ensure volumes increase monotonically
    const vols = s.forecast.demandCurve.map(p => p.mw);
    for (let i = 1; i < vols.length; i++) {
      expect(vols[i]).toBeGreaterThanOrEqual(vols[i-1]);
    }
  });

  it("clears BM with correct merit order and marginal flag for short system", () => {
    const market = {
      isShort: true,
      sbp: 100,
      ssp: 90,
      niv: -90, // needs 90 MW of offers
    };

    const bids = [
      { id: "A", side: "offer", mw: 50, price: 80 },
      { id: "B", side: "offer", mw: 30, price: 100 },
      { id: "C", side: "offer", mw: 20, price: 120 },
    ];

    const res = clearBM(bids, market);

    expect(res.cp).toBe(120); // last accepted unit sets clearing price
    expect(res.cleared).toBeCloseTo(90, 6);
    expect(res.full).toBe(true); // demand fully covered
    expect(res.accepted).toHaveLength(3);

    const [a, b, c] = res.accepted;
    expect(a.id).toBe("A");
    expect(a.mwAcc).toBe(50);
    expect(a.marginal).toBe(false);

    expect(b.id).toBe("B");
    expect(b.mwAcc).toBe(30);
    expect(b.marginal).toBe(false);

    expect(c.id).toBe("C");
    expect(c.mwAcc).toBe(10); // only 10 MW needed to finish clearing
    expect(c.marginal).toBe(true);
  });
});

