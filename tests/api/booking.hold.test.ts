import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  bookingCreate: vi.fn(),
  bookingUpdate: vi.fn(),
  createBookingEvent: vi.fn(),
  revalidatePath: vi.fn(),
  getPacificAucklandOffset: vi.fn(),
  randomUUID: vi.fn(),
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: { booking: { create: mocks.bookingCreate, update: mocks.bookingUpdate } },
}));

vi.mock("@/features/calendar/lib/google-calendar", () => ({
  createBookingEvent: mocks.createBookingEvent,
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

vi.mock("@/shared/lib/timezone-utils", () => ({
  getPacificAucklandOffset: mocks.getPacificAucklandOffset,
}));

vi.mock("crypto", () => ({ randomUUID: mocks.randomUUID }));

import { POST } from "../../src/app/api/booking/hold/route";

/**
 * Creates a fake NextRequest with the given JSON body.
 * @param body - The request body object.
 * @returns A minimal fake NextRequest.
 */
function makeRequest(body: object): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

/** A future date that will always pass the "not in the past" check. */
const FUTURE_DATE = "2099-06-15";
const SLOT_START = "10:00";
const SLOT_END = "11:00";

/** Minimal valid in-person payload. */
const VALID_BODY = {
  name: "Alice Smith",
  email: "alice@example.com",
  dateKey: FUTURE_DATE,
  slotStart: SLOT_START,
  slotEnd: SLOT_END,
  meetingType: "in-person" as const,
  address: "123 Main St",
};

describe("POST /api/booking/hold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPacificAucklandOffset.mockReturnValue(12);
    mocks.randomUUID.mockReturnValue("uuid-test");
  });

  it("returns 400 when name is missing", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, name: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name/i);
  });

  it("returns 400 when email is invalid", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/email/i);
  });

  it("returns 400 when dateKey is missing", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, dateKey: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/time slot/i);
  });

  it("returns 400 when meetingType is missing", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, meetingType: undefined }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/in-person or remote/i);
  });

  it("returns 400 when in-person appointment has no address", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, address: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/address/i);
  });

  it("returns 400 for a date in the past", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, dateKey: "2000-01-01" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/past/i);
  });

  it("returns 400 for an invalid dateKey format", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, dateKey: "not-a-date" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid date/i);
  });

  it("creates booking and calendar event, returns ok:true", async () => {
    mocks.bookingCreate.mockResolvedValue({ id: "booking-1" });
    mocks.createBookingEvent.mockResolvedValue({ eventId: "cal-event-1" });
    mocks.bookingUpdate.mockResolvedValue({});
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.bookingId).toBe("booking-1");
    expect(mocks.bookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "confirmed" }) }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/booking");
  });

  it("still returns ok:true when calendar event creation fails", async () => {
    mocks.bookingCreate.mockResolvedValue({ id: "booking-2" });
    mocks.createBookingEvent.mockRejectedValue(new Error("Calendar API down"));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.bookingId).toBe("booking-2");
    // Booking was created but not confirmed (no update called)
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
  });

  it("returns 409 on concurrent booking conflict (P2002)", async () => {
    const p2002 = Object.assign(
      new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "0",
      }),
    );
    mocks.bookingCreate.mockRejectedValue(p2002);
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no longer available/i);
  });

  it("returns 500 on unexpected database error", async () => {
    mocks.bookingCreate.mockRejectedValue(new Error("Unexpected DB error"));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(500);
  });

  it("accepts a remote booking without an address", async () => {
    mocks.bookingCreate.mockResolvedValue({ id: "booking-3" });
    mocks.createBookingEvent.mockResolvedValue({ eventId: "cal-3" });
    mocks.bookingUpdate.mockResolvedValue({});
    const res = await POST(
      makeRequest({ ...VALID_BODY, meetingType: "remote", address: undefined }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
