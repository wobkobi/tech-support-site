import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isAdminRequest: vi.fn(),
  importFromGoogleContacts: vi.fn(),
  syncAllContactsToGoogle: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isAdminRequest: mocks.isAdminRequest,
}));

vi.mock("@/features/contacts/lib/google-contacts", () => ({
  importFromGoogleContacts: mocks.importFromGoogleContacts,
  syncAllContactsToGoogle: mocks.syncAllContactsToGoogle,
}));

import { POST } from "../../src/app/api/admin/contacts/sync/route";

const FAKE_REQ = {} as unknown as NextRequest;

describe("POST /api/admin/contacts/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.importFromGoogleContacts.mockResolvedValue(0);
    mocks.syncAllContactsToGoogle.mockResolvedValue(0);
  });

  it("returns 401 when not admin", async () => {
    mocks.isAdminRequest.mockReturnValue(false);
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  it("returns importedCount and syncedCount on success", async () => {
    mocks.importFromGoogleContacts.mockResolvedValue(10);
    mocks.syncAllContactsToGoogle.mockResolvedValue(15);
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.importedCount).toBe(10);
    expect(json.syncedCount).toBe(15);
  });

  it("returns 0 counts when nothing to sync", async () => {
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.importedCount).toBe(0);
    expect(json.syncedCount).toBe(0);
  });

  it("returns 500 with error message when importFromGoogleContacts throws", async () => {
    mocks.importFromGoogleContacts.mockRejectedValue(new Error("API failure"));
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/API failure/);
  });

  it("returns 500 with error message when syncAllContactsToGoogle throws", async () => {
    mocks.syncAllContactsToGoogle.mockRejectedValue(new Error("Sync failed"));
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/Sync failed/);
  });

  it("returns 'Unknown error' when a non-Error is thrown", async () => {
    mocks.importFromGoogleContacts.mockRejectedValue("string error");
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Unknown error");
  });
});
