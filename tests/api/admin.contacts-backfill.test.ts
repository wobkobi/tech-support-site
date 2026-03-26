import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isAdminRequest: vi.fn(),
  bookingFindMany: vi.fn(),
  contactUpsert: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isAdminRequest: mocks.isAdminRequest,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: mocks.bookingFindMany,
    },
    contact: {
      upsert: mocks.contactUpsert,
    },
  },
}));

import { POST } from "../../src/app/api/admin/contacts/backfill/route";

const FAKE_REQ = {} as unknown as NextRequest;

describe("POST /api/admin/contacts/backfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.contactUpsert.mockResolvedValue({});
  });

  it("returns 401 when not admin", async () => {
    mocks.isAdminRequest.mockReturnValue(false);
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(401);
  });

  it("upserts one contact per unique email from bookings", async () => {
    mocks.bookingFindMany.mockResolvedValue([
      {
        name: "Alice",
        email: "alice@example.com",
        notes:
          "Fix my printer\n\n[10am - 1 hr]\nMeeting type: In-person\nAddress: 1 Main St\nPhone: 021 111 2222\n",
      },
      {
        name: "Bob",
        email: "bob@example.com",
        notes: "Help with laptop\n\n[2pm - 1 hr]\nMeeting type: Remote\n",
      },
    ]);

    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.upsertedCount).toBe(2);
    expect(mocks.contactUpsert).toHaveBeenCalledTimes(2);
  });

  it("deduplicates by email, keeping the most recent booking", async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { name: "Alice Old", email: "alice@example.com", notes: "Old\n\nAddress: Old St\n" },
      {
        name: "Alice New",
        email: "alice@example.com",
        notes: "New\n\nAddress: New St\nPhone: 021 999\n",
      },
    ]);

    await POST(FAKE_REQ);

    expect(mocks.contactUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.contactUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "alice@example.com" },
        create: expect.objectContaining({ name: "Alice New", address: "New St", phone: "021 999" }),
      }),
    );
  });

  it("handles bookings with no phone or address in notes", async () => {
    mocks.bookingFindMany.mockResolvedValue([
      {
        name: "Charlie",
        email: "charlie@example.com",
        notes: "Help needed\n\n[10am]\nMeeting type: Remote\n",
      },
    ]);

    await POST(FAKE_REQ);

    expect(mocks.contactUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ phone: null, address: null }),
      }),
    );
  });

  it("handles empty bookings list", async () => {
    mocks.bookingFindMany.mockResolvedValue([]);
    const res = await POST(FAKE_REQ);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.upsertedCount).toBe(0);
    expect(mocks.contactUpsert).not.toHaveBeenCalled();
  });
});
