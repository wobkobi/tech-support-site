import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  formatNZPhone,
  toE164NZ,
  isValidPhone,
} from "../../src/shared/lib/normalize-phone";

describe("normalizePhone", () => {
  it("returns empty string for blank input", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("   ")).toBe("");
  });

  it("strips spaces and dashes from a local number", () => {
    expect(normalizePhone("021 123-456")).toBe("021123456");
  });

  it("preserves leading + for international numbers", () => {
    expect(normalizePhone("+64 21 123 456")).toBe("+6421123456");
  });

  it("strips all non-digit chars except leading +", () => {
    expect(normalizePhone("+1 (800) 555-1234")).toBe("+18005551234");
  });

  it("returns digits only for a number without +", () => {
    expect(normalizePhone("09 123 4567")).toBe("091234567");
  });
});

describe("formatNZPhone", () => {
  it("returns empty string for empty input", () => {
    expect(formatNZPhone("")).toBe("");
  });

  it("formats NZ mobile (021) as XXX XXX XXXX", () => {
    expect(formatNZPhone("0211231234")).toBe("021 123 1234");
  });

  it("formats NZ mobile (027) as XXX XXX XXXX", () => {
    expect(formatNZPhone("0271231234")).toBe("027 123 1234");
  });

  it("formats NZ landline as XX XXX XXXX", () => {
    expect(formatNZPhone("091234567")).toBe("09 123 4567");
  });

  it("formats international number with + prefix", () => {
    const result = formatNZPhone("+6421123456");
    expect(result).toMatch(/^\+64/);
  });

  it("returns just + for input that is only +", () => {
    expect(formatNZPhone("+")).toBe("+");
  });
});

describe("toE164NZ", () => {
  it("returns empty string for blank input", () => {
    expect(toE164NZ("")).toBe("");
    expect(toE164NZ("   ")).toBe("");
  });

  it("converts NZ mobile with leading 0 to E.164", () => {
    expect(toE164NZ("021 123 1234")).toBe("+64211231234");
  });

  it("converts NZ mobile without leading 0 to E.164", () => {
    expect(toE164NZ("21 123 1234")).toBe("+64211231234");
  });

  it("converts NZ landline to E.164", () => {
    expect(toE164NZ("09 123 4567")).toBe("+6491234567");
  });

  it("passes through already-E.164 NZ number unchanged (strips spaces)", () => {
    expect(toE164NZ("+64 21 123 1234")).toBe("+64211231234");
  });

  it("passes through non-NZ international number unchanged", () => {
    expect(toE164NZ("+61 400 000 000")).toBe("+61400000000");
  });

  it("returns raw digits for unknown format without +", () => {
    // 10-digit number not matching NZ mobile short prefixes - returned as digits
    expect(toE164NZ("1234567890")).toBe("1234567890");
  });
});

describe("isValidPhone", () => {
  it("returns true for empty string (field is optional)", () => {
    expect(isValidPhone("")).toBe(true);
  });

  it("returns true for a valid 10-digit number", () => {
    expect(isValidPhone("0211231234")).toBe(true);
  });

  it("returns true for an E.164 number", () => {
    expect(isValidPhone("+64211231234")).toBe(true);
  });

  it("returns false for fewer than 7 digits", () => {
    expect(isValidPhone("12345")).toBe(false);
  });

  it("returns false for more than 15 digits", () => {
    expect(isValidPhone("1234567890123456")).toBe(false);
  });

  it("returns true for exactly 7 digits", () => {
    expect(isValidPhone("1234567")).toBe(true);
  });

  it("returns true for exactly 15 digits", () => {
    expect(isValidPhone("123456789012345")).toBe(true);
  });
});
