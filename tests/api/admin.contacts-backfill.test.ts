import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isAdminRequest: vi.fn(),
  bookingFindMany: vi.fn(),
  reviewRequestFindMany: vi.fn(),
  contactFindFirst: vi.fn(),
  contactCreate: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isAdminRequest: mocks.isAdminRequest,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: mocks.bookingFindMany,
    },
    reviewRequest: {
      findMany: mocks.reviewRequestFindMany,
    },
    contact: {
      findFirst: mocks.contactFindFirst,
      create: mocks.contactCreate,
    },
  },
}));

import { POST } from "../../src/app/api/admin/contacts/backfill/route";

const FAKE_REQ = {} as unknown as NextRequest;

describe("POST /api/admin/contacts/backfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.bookingFindMany.mockResolvedValue([]);
    mocks.reviewRequestFindMany.mockResolvedValue([]);
    mocks.contactFindFirst.mockResolvedValue(null);
    mocks.contactCreate.mockResolvedValue({});
  });

  it("returns 401 when not admin", async () => {
    mocks.isAdminRequest.mockReturnValue(false);
    const res = await POST(FAKE_REQ);
    expect(res.status).toBe(401);
  });

  it("creates one contact per unique email from bookings", async () => {
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
    expect(mocks.contactCreate).toHaveBeenCalledTimes(2);
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

    expect(mocks.contactCreate).toHaveBeenCalledTimes(1);
    expect(mocks.contactCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Alice New",
        email: "alice@example.com",
        address: "New St",
        phone: "+6421999",
      }),
    });
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

    expect(mocks.contactCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ phone: null, address: null }),
    });
  });

  it("handles empty bookings list", async () => {
    mocks.bookingFindMany.mockResolvedValue([]);
    const res = await POST(FAKE_REQ);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.upsertedCount).toBe(0);
    expect(mocks.contactCreate).not.toHaveBeenCalled();
  });

  it("handles bookings with null notes gracefully", async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { name: "Dana", email: "dana@example.com", notes: null },
    ]);
    await POST(FAKE_REQ);
    expect(mocks.contactCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ phone: null, address: null }),
    });
  });
});
