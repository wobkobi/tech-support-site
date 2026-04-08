import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isAdminRequest: vi.fn(),
  travelBlockFindUnique: vi.fn(),
  travelBlockUpdate: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isAdminRequest: mocks.isAdminRequest,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    travelBlock: {
      findUnique: mocks.travelBlockFindUnique,
      update: mocks.travelBlockUpdate,
    },
  },
}));

import { PATCH } from "../../src/app/api/admin/travel/[id]/route";

/**
 * Creates a minimal fake NextRequest with a JSON body.
 * @param body - Request body.
 * @returns A minimal fake NextRequest.
 */
function makeRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

const params = Promise.resolve({ id: "block-1" });

describe("PATCH /api/admin/travel/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.travelBlockFindUnique.mockResolvedValue({ id: "block-1" });
    mocks.travelBlockUpdate.mockResolvedValue({});
  });

  it("returns 401 when not admin", async () => {
    mocks.isAdminRequest.mockReturnValue(false);
    const res = await PATCH(makeRequest({ transportMode: "driving" }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid transport mode", async () => {
    const res = await PATCH(makeRequest({ transportMode: "teleport" }), { params });
    expect(res.status).toBe(400);
  });

  it("returns 400 when body has no recognised field", async () => {
    const res = await PATCH(makeRequest({}), { params });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the block does not exist", async () => {
    mocks.travelBlockFindUnique.mockResolvedValue(null);
    const res = await PATCH(makeRequest({ transportMode: "driving" }), { params });
    expect(res.status).toBe(404);
  });

  it("updates transport mode and clears raw minutes", async () => {
    const res = await PATCH(makeRequest({ transportMode: "driving" }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mocks.travelBlockUpdate).toHaveBeenCalledWith({
      where: { id: "block-1" },
      data: expect.objectContaining({
        transportMode: "driving",
        rawTravelMinutes: null,
        roundedMinutes: null,
        rawTravelBackMinutes: null,
        roundedBackMinutes: null,
      }),
    });
  });

  it("updates customOrigin and clears raw minutes", async () => {
    const res = await PATCH(makeRequest({ customOrigin: "42 Custom St" }), { params });
    expect(res.status).toBe(200);
    expect(mocks.travelBlockUpdate).toHaveBeenCalledWith({
      where: { id: "block-1" },
      data: expect.objectContaining({
        customOrigin: "42 Custom St",
        rawTravelMinutes: null,
      }),
    });
  });

  it("clears customOrigin when null is passed", async () => {
    const res = await PATCH(makeRequest({ customOrigin: null }), { params });
    expect(res.status).toBe(200);
    expect(mocks.travelBlockUpdate).toHaveBeenCalledWith({
      where: { id: "block-1" },
      data: expect.objectContaining({ customOrigin: null }),
    });
  });

  it("can update both mode and origin in one call", async () => {
    const res = await PATCH(
      makeRequest({ transportMode: "walking", customOrigin: "99 Other St" }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(mocks.travelBlockUpdate).toHaveBeenCalledWith({
      where: { id: "block-1" },
      data: expect.objectContaining({
        transportMode: "walking",
        customOrigin: "99 Other St",
      }),
    });
  });

  it("returns 500 when an error is thrown", async () => {
    mocks.travelBlockUpdate.mockRejectedValue(new Error("DB error"));
    const res = await PATCH(makeRequest({ transportMode: "driving" }), { params });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});
