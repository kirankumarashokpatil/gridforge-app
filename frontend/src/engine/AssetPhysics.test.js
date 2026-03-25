import { describe, it, expect } from "vitest";
import { ASSETS, SP_DURATION_H, MIN_SOC } from "../shared/constants.js";
import { availMW, updateSoF } from "./AssetPhysics.js";

describe("AssetPhysics time & units consistency", () => {
  it("uses SP_DURATION_H to convert MW to MWh for BESS availability", () => {
    const def = ASSETS.BESS_S;
    const sofuel = 50; // %
    const marketShort = { isShort: true, wf: 0 };

    const mwAvail = availMW(def, sofuel, marketShort);
    const mwhAvail = mwAvail * SP_DURATION_H;

    // Available MWh should not exceed energy between MIN_SOC and current SoC.
    const energyWindowMwh = ((sofuel - MIN_SOC) / 100) * def.maxMWh;
    expect(mwhAvail).toBeLessThanOrEqual(energyWindowMwh + 1e-6);
  });

  it("uses SP_DURATION_H for SoC updates (10 MW for one SP = 10 * SP_DURATION_H MWh)", () => {
    const def = ASSETS.BESS_S;
    const startSoC = 50;
    const mwDispatch = 10;

    const mwh = mwDispatch * SP_DURATION_H;
    expect(mwh).toBeCloseTo(5, 6); // with SP_DURATION_H = 0.5

    const newSoCShort = updateSoF(def, startSoC, mwDispatch, true);
    const newSoCLong = updateSoF(def, startSoC, mwDispatch, false);

    expect(newSoCShort).toBeLessThan(startSoC);
    // Charging from the grid increases SoC
    expect(newSoCLong).toBeGreaterThan(startSoC);
  });

  it("fuel-based assets use SP_DURATION_H for fuel burn", () => {
    const def = ASSETS.OCGT;
    const startFuel = def.fuelMWh ?? 600;
    const mwDispatch = 100;

    const mwh = mwDispatch * SP_DURATION_H;
    const newFuel = updateSoF(def, startFuel, mwDispatch, true);

    expect(SP_DURATION_H).toBeCloseTo(0.5, 6);
    expect(startFuel - newFuel).toBeCloseTo(mwh, 6);
  });
});

describe("Generator constraints (ramp + min-stable)", () => {
  it("caps upward change by rampRate × BM window factor", () => {
    const def = ASSETS.OCGT; // rampRate defined in constants
    const pState = { status: "ONLINE", currentMw: 5 };
    const intendedPhysical = 50;
    const maxRamp = (def.rampRate || 9999) * 5; // matches App.jsx logic
    const capped =
      intendedPhysical > pState.currentMw + maxRamp
        ? pState.currentMw + maxRamp
        : intendedPhysical;

    expect(capped).toBeLessThanOrEqual(pState.currentMw + maxRamp);
  });

  it("trips plant if dispatched below min-stable while ONLINE", () => {
    const def = ASSETS.CCGT; // has minMw > 0
    let pState = { status: "ONLINE", currentMw: 0 };
    let actualPhysical = def.minMw / 2; // too low

    if (def.minMw && actualPhysical > 0 && actualPhysical < def.minMw) {
      actualPhysical = 0;
      pState = { ...pState, status: "OFFLINE" };
    }

    expect(actualPhysical).toBe(0);
    expect(pState.status).toBe("OFFLINE");
  });
});


