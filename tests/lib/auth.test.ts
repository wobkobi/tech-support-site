import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { isValidAdminToken, isAdminRequest, isCronAuthorized } from "../../src/shared/lib/auth";

describe("isValidAdminToken", () => {
  const originalSecret = process.env.ADMIN_SECRET;

  beforeEach(() => {
    process.env.ADMIN_SECRET = "test-admin-secret";
  });

  afterEach(() => {
    process.env.ADMIN_SECRET = originalSecret;
  });

  it("returns false when ADMIN_SECRET is not set", () => {
    delete process.env.ADMIN_SECRET;
    expect(isValidAdminToken("test-admin-secret")).toBe(false);
  });

  it("returns false when token is null", () => {
    expect(isValidAdminToken(null)).toBe(false);
  });

  it("returns false when token is undefined", () => {
    expect(isValidAdminToken(undefined)).toBe(false);
  });

  it("returns false when token is empty string", () => {
    expect(isValidAdminToken("")).toBe(false);
  });

  it("returns true when token exactly matches ADMIN_SECRET", () => {
    expect(isValidAdminToken("test-admin-secret")).toBe(true);
  });

  it("returns false when token does not match ADMIN_SECRET", () => {
    expect(isValidAdminToken("wrong-secret")).toBe(false);
  });

  it("returns false when token length differs from secret (timingSafeEqual throws - caught)", () => {
    // timingSafeEqual requires equal-length buffers; mismatch is caught and returns false
    expect(isValidAdminToken("short")).toBe(false);
  });
});

describe("isAdminRequest", () => {
  const originalSecret = process.env.ADMIN_SECRET;

  beforeEach(() => {
    process.env.ADMIN_SECRET = "test-admin-secret";
  });

  afterEach(() => {
    process.env.ADMIN_SECRET = originalSecret;
  });

  it("returns false when x-admin-secret header is absent", () => {
    const req = new NextRequest("http://localhost/api/test");
    expect(isAdminRequest(req)).toBe(false);
  });

  it("returns true when x-admin-secret matches ADMIN_SECRET", () => {
    const req = new NextRequest("http://localhost/api/test", {
      headers: { "x-admin-secret": "test-admin-secret" },
    });
    expect(isAdminRequest(req)).toBe(true);
  });

  it("returns false when x-admin-secret does not match", () => {
    const req = new NextRequest("http://localhost/api/test", {
      headers: { "x-admin-secret": "wrong-secret" },
    });
    expect(isAdminRequest(req)).toBe(false);
  });
});

describe("isCronAuthorized", () => {
  const originalSecret = process.env.CRON_SECRET;

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it("returns false when no CRON_SECRET and no x-vercel-cron header", () => {
    delete process.env.CRON_SECRET;
    const req = new NextRequest("http://localhost/api/cron/test");
    expect(isCronAuthorized(req)).toBe(false);
  });

  it("returns true when no CRON_SECRET but x-vercel-cron header present", () => {
    delete process.env.CRON_SECRET;
    const req = new NextRequest("http://localhost/api/cron/test", {
      headers: { "x-vercel-cron": "1" },
    });
    expect(isCronAuthorized(req)).toBe(true);
  });

  it("returns true when CRON_SECRET set and Bearer token matches", () => {
    process.env.CRON_SECRET = "my-cron-secret";
    const req = new NextRequest("http://localhost/api/cron/test", {
      headers: { authorization: "Bearer my-cron-secret" },
    });
    expect(isCronAuthorized(req)).toBe(true);
  });

  it("returns false when CRON_SECRET set but Bearer token does not match", () => {
    process.env.CRON_SECRET = "my-cron-secret";
    const req = new NextRequest("http://localhost/api/cron/test", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    expect(isCronAuthorized(req)).toBe(false);
  });

  it("returns false when CRON_SECRET set with no auth headers at all", () => {
    process.env.CRON_SECRET = "my-cron-secret";
    const req = new NextRequest("http://localhost/api/cron/test");
    expect(isCronAuthorized(req)).toBe(false);
  });

  it("returns true when CRON_SECRET set and x-vercel-cron header present", () => {
    process.env.CRON_SECRET = "my-cron-secret";
    const req = new NextRequest("http://localhost/api/cron/test", {
      headers: { "x-vercel-cron": "1" },
    });
    expect(isCronAuthorized(req)).toBe(true);
  });
});
