import { describe, it, expect } from "vitest";
import { getPacificAucklandOffset } from "../../src/shared/lib/timezone-utils";

describe("getPacificAucklandOffset", () => {
  // NZ Daylight Time (NZDT) = UTC+13: roughly October through April
  // NZ Standard Time (NZST) = UTC+12: roughly April through September

  it("returns 13 (NZDT) for a summer date - January", () => {
    expect(getPacificAucklandOffset(2026, 1, 15)).toBe(13);
  });

  it("returns 13 (NZDT) for a late-summer date - March", () => {
    expect(getPacificAucklandOffset(2026, 3, 1)).toBe(13);
  });

  it("returns 12 (NZST) for a winter date - July", () => {
    expect(getPacificAucklandOffset(2026, 7, 15)).toBe(12);
  });

  it("returns 12 (NZST) for a mid-winter date - August", () => {
    expect(getPacificAucklandOffset(2026, 8, 1)).toBe(12);
  });

  it("returns 12 (NZST) for a late-winter date - September (before DST restarts)", () => {
    // DST in NZ restarts late September; Sep 15 is still standard time
    expect(getPacificAucklandOffset(2026, 9, 15)).toBe(12);
  });

  it("returns a number (12 or 13) for any valid date", () => {
    const offset = getPacificAucklandOffset(2025, 12, 25);
    expect([12, 13]).toContain(offset);
  });
});
