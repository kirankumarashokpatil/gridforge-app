import { describe, it, expect } from "vitest";
import { canSubmitBmBid } from "./GateLogic.js";

describe("GateLogic", () => {
  it("allows BM bids during BM, BM_OPEN, and REALTIME phases", () => {
    expect(canSubmitBmBid("BM", 10_000)).toBe(true);
    expect(canSubmitBmBid("BM_OPEN", 10_000)).toBe(true);
    expect(canSubmitBmBid("REALTIME", 10_000)).toBe(true);
  });

  it("rejects BM bids during non-BM phases", () => {
    expect(canSubmitBmBid("DA", 10_000)).toBe(false);
    expect(canSubmitBmBid("ID", 10_000)).toBe(false);
    expect(canSubmitBmBid("FORECAST", 10_000)).toBe(false);
    expect(canSubmitBmBid("IDA1", 10_000)).toBe(false);
    expect(canSubmitBmBid("IDA2", 10_000)).toBe(false);
    expect(canSubmitBmBid("RESULTS", 10_000)).toBe(false);
    expect(canSubmitBmBid("SETTLED", 10_000)).toBe(false);
    expect(canSubmitBmBid("BM_CLOSE", 10_000)).toBe(false);
    expect(canSubmitBmBid("UNKNOWN", 10_000)).toBe(false);
  });

  it("enforces gate closure based on timer expiry", () => {
    for (const phase of ["BM", "BM_OPEN", "REALTIME"]) {
      // 1 second before gate closure → bid accepted
      expect(canSubmitBmBid(phase, 1000)).toBe(true);

      // At or after gate closure instant → bid rejected
      expect(canSubmitBmBid(phase, 0)).toBe(false);
      expect(canSubmitBmBid(phase, -1)).toBe(false);
    }
  });
});


