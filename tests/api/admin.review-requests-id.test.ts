import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isValidAdminToken: vi.fn(),
  toE164NZ: vi.fn((p: string) => p),
  isValidPhone: vi.fn(),
  reviewRequestUpdate: vi.fn(),
  reviewRequestDelete: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isValidAdminToken: mocks.isValidAdminToken,
}));

vi.mock("@/shared/lib/normalize-phone", () => ({
  toE164NZ: mocks.toE164NZ,
  isValidPhone: mocks.isValidPhone,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    reviewRequest: {
      update: mocks.reviewRequestUpdate,
      delete: mocks.reviewRequestDelete,
    },
  },
}));

import { PATCH, DELETE } from "../../src/app/api/admin/review-requests/[id]/route";

const PARAMS = { params: Promise.resolve({ id: "rr-123" }) };

/**
 * Creates a fake NextRequest with the given JSON body.
 * @param body - The request body object.
 * @returns A minimal fake NextRequest.
 */
function makeRequest(body: object): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

/**
 * Creates a fake NextRequest with a ?token= query param for DELETE.
 * @param token - The admin token value.
 * @returns A minimal fake NextRequest.
 */
function makeDeleteRequest(token: string | null): NextRequest {
  return {
    nextUrl: { searchParams: { get: (key: string) => (key === "token" ? token : null) } },
  } as unknown as NextRequest;
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

describe("PATCH /api/admin/review-requests/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isValidAdminToken.mockReturnValue(true);
    mocks.isValidPhone.mockReturnValue(true);
    mocks.toE164NZ.mockImplementation((p: string) => p);
    mocks.reviewRequestUpdate.mockResolvedValue({});
  });

  it("returns 401 when admin token is invalid", async () => {
    mocks.isValidAdminToken.mockReturnValue(false);
    const res = await PATCH(
      makeRequest({ token: "bad", name: "Alice", phone: "021 000 0000" }),
      PARAMS,
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 400 when name is missing", async () => {
    const res = await PATCH(makeRequest({ token: "good", phone: "021 000 0000" }), PARAMS);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/name/i);
  });

  it("returns 400 when phone is invalid", async () => {
    mocks.isValidPhone.mockReturnValue(false);
    const res = await PATCH(makeRequest({ token: "good", name: "Alice", phone: "bad" }), PARAMS);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/phone/i);
  });

  it("updates the review request and returns ok:true", async () => {
    const res = await PATCH(
      makeRequest({
        token: "good",
        name: "  Alice  ",
        email: "ALICE@EXAMPLE.COM",
        phone: "021 000 0000",
      }),
      PARAMS,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mocks.reviewRequestUpdate).toHaveBeenCalledWith({
      where: { id: "rr-123" },
      data: {
        name: "Alice",
        email: "alice@example.com",
        phone: "021 000 0000",
      },
    });
  });

  it("returns 500 when the database throws", async () => {
    mocks.reviewRequestUpdate.mockRejectedValue(new Error("DB down"));
    const res = await PATCH(
      makeRequest({ token: "good", name: "Alice", phone: "021 000 0000" }),
      PARAMS,
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe("DELETE /api/admin/review-requests/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isValidAdminToken.mockReturnValue(true);
    mocks.reviewRequestDelete.mockResolvedValue({});
  });

  it("returns 401 when admin token is invalid", async () => {
    mocks.isValidAdminToken.mockReturnValue(false);
    const res = await DELETE(makeDeleteRequest("bad-token"), PARAMS);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("deletes the review request and returns ok:true", async () => {
    const res = await DELETE(makeDeleteRequest("good-token"), PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mocks.reviewRequestDelete).toHaveBeenCalledWith({ where: { id: "rr-123" } });
  });

  it("returns 500 when the database throws", async () => {
    mocks.reviewRequestDelete.mockRejectedValue(new Error("DB down"));
    const res = await DELETE(makeDeleteRequest("good-token"), PARAMS);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});
