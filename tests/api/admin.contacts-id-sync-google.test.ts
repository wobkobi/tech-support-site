import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isAdminRequest: vi.fn(),
  syncContactToGoogle: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isAdminRequest: mocks.isAdminRequest,
}));

vi.mock("@/features/contacts/lib/google-contacts", () => ({
  syncContactToGoogle: mocks.syncContactToGoogle,
}));

import { POST } from "../../src/app/api/admin/contacts/[id]/sync-google/route";

const FAKE_REQ = {} as unknown as NextRequest;
const PARAMS = { params: Promise.resolve({ id: "contact-xyz" }) };

describe("POST /api/admin/contacts/[id]/sync-google", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.syncContactToGoogle.mockResolvedValue(undefined);
  });

  it("returns 401 when not admin", async () => {
    mocks.isAdminRequest.mockReturnValue(false);
    const res = await POST(FAKE_REQ, PARAMS);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("calls syncContactToGoogle with the contact ID", async () => {
    await POST(FAKE_REQ, PARAMS);
    expect(mocks.syncContactToGoogle).toHaveBeenCalledWith("contact-xyz");
  });

  it("returns ok:true on success", async () => {
    const res = await POST(FAKE_REQ, PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("returns ok:false (not 500) when syncContactToGoogle throws", async () => {
    mocks.syncContactToGoogle.mockRejectedValue(new Error("Google API error"));
    const res = await POST(FAKE_REQ, PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBeDefined();
  });

  it("still returns a response even when sync throws unexpectedly", async () => {
    mocks.syncContactToGoogle.mockRejectedValue(new Error("Network timeout"));
    const res = await POST(FAKE_REQ, PARAMS);
    expect(res).toBeDefined();
    const json = await res.json();
    expect(json).toHaveProperty("ok");
  });
});
