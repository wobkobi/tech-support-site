import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isAdminRequest: vi.fn(),
  importFromGoogleContacts: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isAdminRequest: mocks.isAdminRequest,
}));

vi.mock("@/features/contacts/lib/google-contacts", () => ({
  importFromGoogleContacts: mocks.importFromGoogleContacts,
}));

import { POST } from "../../src/app/api/admin/contacts/import/route";

const FAKE_REQ = {} as unknown as NextRequest;

describe("POST /api/admin/contacts/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.importFromGoogleContacts.mockResolvedValue(0);
  });

  it("returns 401 when not admin", async () => {
    mocks.isAdminRequest.mockReturnValue(false);
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns importedCount on success", async () => {
    mocks.importFromGoogleContacts.mockResolvedValue(42);
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.importedCount).toBe(42);
  });

  it("returns 0 importedCount when no contacts found", async () => {
    mocks.importFromGoogleContacts.mockResolvedValue(0);
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.importedCount).toBe(0);
  });

  it("returns 500 when importFromGoogleContacts throws", async () => {
    mocks.importFromGoogleContacts.mockRejectedValue(new Error("API failure"));
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/API failure/);
  });
});
