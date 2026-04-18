import { describe, it, expect } from "vitest";
import { cn } from "@/shared/lib/cn";

describe("cn", () => {
  it("returns empty string with no arguments", () => {
    expect(cn()).toBe("");
  });

  it("returns a single class unchanged", () => {
    expect(cn("foo")).toBe("foo");
  });

  it("joins multiple classes with a space", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("ignores falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("resolves Tailwind conflicts keeping the last class", () => {
    expect(cn("p-4", "p-8")).toBe("p-8");
  });

  it("handles conditional object syntax", () => {
    expect(cn({ "text-red-500": true, "text-blue-500": false })).toBe("text-red-500");
  });
});
