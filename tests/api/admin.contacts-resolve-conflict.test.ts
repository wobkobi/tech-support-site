import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isAdminRequest: vi.fn(),
  contactUpdate: vi.fn(),
  reviewRequestUpdate: vi.fn(),
  bookingUpdate: vi.fn(),
  reviewUpdate: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({ isAdminRequest: mocks.isAdminRequest }));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    contact: { update: mocks.contactUpdate },
    reviewRequest: { update: mocks.reviewRequestUpdate },
    booking: { update: mocks.bookingUpdate },
    review: { update: mocks.reviewUpdate },
  },
}));

import { POST } from "../../src/app/api/admin/contacts/resolve-conflict/route";

/**
 * Builds a minimal fake NextRequest with a JSON body.
 * @param body - Request body to serialize.
 * @returns Fake NextRequest.
 */
function makeRequest(body: object): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: { get: () => null },
  } as unknown as NextRequest;
}

describe("POST /api/admin/contacts/resolve-conflict", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.contactUpdate.mockResolvedValue({});
    mocks.reviewRequestUpdate.mockResolvedValue({});
    mocks.bookingUpdate.mockResolvedValue({});
    mocks.reviewUpdate.mockResolvedValue({});
  });

  it("returns 401 when not admin", async () => {
    mocks.isAdminRequest.mockReturnValue(false);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await POST(makeRequest({ contactId: "c1" }));
    expect(res.status).toBe(400);
  });

  it("updates contact and ReviewRequest with chosen name", async () => {
    const res = await POST(
      makeRequest({
        contactId: "c1",
        sourceId: "rr-1",
        source: "ReviewRequest",
        name: "Alice Smith",
      }),
    );
    expect(res.status).toBe(200);
    expect(mocks.contactUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { name: "Alice Smith" },
    });
    expect(mocks.reviewRequestUpdate).toHaveBeenCalledWith({
      where: { id: "rr-1" },
      data: { name: "Alice Smith" },
    });
  });

  it("updates contact and Booking with chosen phone", async () => {
    const res = await POST(
      makeRequest({
        contactId: "c1",
        sourceId: "b-1",
        source: "Booking",
        phone: "021 111 2222",
      }),
    );
    expect(res.status).toBe(200);
    expect(mocks.contactUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { phone: "+64211112222" },
    });
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      where: { id: "b-1" },
      data: { phone: "+64211112222" },
    });
  });

  it("updates contact and splits name into firstName/lastName for Review source", async () => {
    const res = await POST(
      makeRequest({
        contactId: "c1",
        sourceId: "rev-1",
        source: "Review",
        name: "Alice Smith",
      }),
    );
    expect(res.status).toBe(200);
    expect(mocks.contactUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { name: "Alice Smith" },
    });
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: "rev-1" },
      data: { firstName: "Alice", lastName: "Smith" },
    });
  });

  it("sets lastName to null for single-word name on Review source", async () => {
    await POST(
      makeRequest({
        contactId: "c1",
        sourceId: "rev-1",
        source: "Review",
        name: "Alice",
      }),
    );
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: "rev-1" },
      data: { firstName: "Alice", lastName: null },
    });
  });

  it("does not update Review when only phone is provided", async () => {
    await POST(
      makeRequest({
        contactId: "c1",
        sourceId: "rev-1",
        source: "Review",
        phone: "021 111 2222",
      }),
    );
    expect(mocks.reviewUpdate).not.toHaveBeenCalled();
  });

  it("returns 500 on unexpected DB error", async () => {
    mocks.contactUpdate.mockRejectedValue(new Error("DB down"));
    const res = await POST(
      makeRequest({
        contactId: "c1",
        sourceId: "rr-1",
        source: "ReviewRequest",
        name: "Alice",
      }),
    );
    expect(res.status).toBe(500);
  });
});
