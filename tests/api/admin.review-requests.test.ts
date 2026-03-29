import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isValidAdminToken: vi.fn(),
  toE164NZ: vi.fn((p: string) => p),
  isValidPhone: vi.fn(),
  reviewRequestFindUnique: vi.fn(),
  reviewRequestUpdate: vi.fn(),
  reviewRequestCreate: vi.fn(),
  reviewUpdate: vi.fn(),
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
      findUnique: mocks.reviewRequestFindUnique,
      update: mocks.reviewRequestUpdate,
      create: mocks.reviewRequestCreate,
    },
    review: {
      update: mocks.reviewUpdate,
    },
    contact: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { POST } from "../../src/app/api/admin/review-requests/route";

/**
 * Creates a fake NextRequest with the given JSON body.
 * @param body - The request body object.
 * @returns A minimal fake NextRequest.
 */
function makeRequest(body: object): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe("POST /api/admin/review-requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isValidAdminToken.mockReturnValue(true);
    mocks.isValidPhone.mockReturnValue(true);
    mocks.toE164NZ.mockImplementation((p: string) => p);
    mocks.reviewRequestFindUnique.mockResolvedValue(null);
    mocks.reviewRequestCreate.mockResolvedValue({ id: "rr-1", reviewToken: "tok-abc" });
    mocks.reviewRequestUpdate.mockResolvedValue({});
    mocks.reviewUpdate.mockResolvedValue({});
  });

  it("returns 401 when admin token is invalid", async () => {
    mocks.isValidAdminToken.mockReturnValue(false);
    const res = await POST(
      makeRequest({ token: "bad", name: "Alice", customerRef: "ref-1", phone: "021 000 0000" }),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 400 when name is missing", async () => {
    const res = await POST(
      makeRequest({ token: "good", customerRef: "ref-1", phone: "021 000 0000" }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/name/i);
  });

  it("returns 400 when both customerRef and reviewId are absent", async () => {
    const res = await POST(makeRequest({ token: "good", name: "Alice", phone: "021 000 0000" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/customerRef or reviewId/i);
  });

  it("returns 400 when phone is invalid", async () => {
    mocks.isValidPhone.mockReturnValue(false);
    const res = await POST(
      makeRequest({ token: "good", name: "Alice", customerRef: "ref-1", phone: "bad" }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/phone/i);
  });

  it("updates and returns existing id when customerRef ReviewRequest already exists", async () => {
    mocks.reviewRequestFindUnique.mockResolvedValue({ id: "existing-rr" });
    const res = await POST(
      makeRequest({ token: "good", name: "Alice", customerRef: "ref-1", phone: "021 000 0000" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.id).toBe("existing-rr");
    expect(mocks.reviewRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "existing-rr" } }),
    );
    expect(mocks.reviewRequestCreate).not.toHaveBeenCalled();
  });

  it("creates ReviewRequest with customerRef token when no existing record", async () => {
    mocks.reviewRequestCreate.mockResolvedValue({ id: "rr-new", reviewToken: "ref-1" });
    const res = await POST(
      makeRequest({ token: "good", name: "Alice", customerRef: "ref-1", phone: "021 000 0000" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.id).toBe("rr-new");
    expect(json.token).toBe("ref-1");
    expect(json.reviewUrl).toContain("ref-1");
  });

  it("creates ReviewRequest and back-links Review when only reviewId is provided", async () => {
    mocks.reviewRequestCreate.mockResolvedValue({ id: "rr-fresh", reviewToken: "gen-tok" });
    const res = await POST(
      makeRequest({ token: "good", name: "Alice", reviewId: "rev-99", phone: "021 000 0000" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.token).toBe("gen-tok");
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: "rev-99" },
      data: { customerRef: "gen-tok" },
    });
  });

  it("returns 500 when the database throws", async () => {
    mocks.reviewRequestCreate.mockRejectedValue(new Error("DB down"));
    const res = await POST(
      makeRequest({ token: "good", name: "Alice", customerRef: "ref-1", phone: "021 000 0000" }),
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});
