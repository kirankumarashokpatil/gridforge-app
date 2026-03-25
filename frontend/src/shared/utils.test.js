import { describe, it, expect } from "vitest";
import { SP_DURATION_H } from "./constants.js";
import { spTime } from "./utils.js";

// We explicitly assert 48 SPs per day here to match the training material,
// even though it's not a runtime constant in the codebase.
const SPS_PER_DAY = 48;

describe("Time & units consistency helpers", () => {
  it("maps settlement periods to wall-clock time with 48 SPs per day", () => {
    // SP 1 = 00:00–00:30, SP 2 = 00:30–01:00, ..., SP 48 = 23:30–00:00
    expect(SP_DURATION_H).toBeCloseTo(0.5, 6);
    expect(spTime(1)).toBe("00:00");
    expect(spTime(2)).toBe("00:30");
    expect(spTime(48)).toBe("23:30");
  });

  it("guards against out-of-range SP numbers", () => {
    const inRange = (sp) => sp >= 1 && sp <= SPS_PER_DAY;
    expect(inRange(1)).toBe(true);
    expect(inRange(48)).toBe(true);
    expect(inRange(0)).toBe(false);
    expect(inRange(49)).toBe(false);
  });

  it("converts MW to MWh using SP_DURATION_H", () => {
    const mw = 10;
    const mwh = mw * SP_DURATION_H;
    // 10 MW for 1 SP of 0.5h = 5 MWh
    expect(mwh).toBeCloseTo(5, 6);
  });
});


