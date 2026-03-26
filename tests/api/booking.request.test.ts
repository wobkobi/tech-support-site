import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  bookingFindMany: vi.fn(),
  bookingCreate: vi.fn(),
  contactUpsert: vi.fn(),
  fetchAllCalendarEvents: vi.fn(),
  createBookingEvent: vi.fn(),
  sendOwnerBookingNotification: vi.fn(),
  sendCustomerBookingConfirmation: vi.fn(),
  syncContactToGoogle: vi.fn(),
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: mocks.bookingFindMany,
      create: mocks.bookingCreate,
    },
    contact: {
      upsert: mocks.contactUpsert,
    },
  },
}));

vi.mock("@/features/calendar/lib/google-calendar", () => ({
  fetchAllCalendarEvents: mocks.fetchAllCalendarEvents,
  createBookingEvent: mocks.createBookingEvent,
}));

vi.mock("@/features/reviews/lib/email", () => ({
  sendOwnerBookingNotification: mocks.sendOwnerBookingNotification,
  sendCustomerBookingConfirmation: mocks.sendCustomerBookingConfirmation,
}));

vi.mock("@/features/contacts/lib/google-contacts", () => ({
  syncContactToGoogle: mocks.syncContactToGoogle,
}));

import { POST } from "../../src/app/api/booking/request/route";

/**
 * Creates a fake NextRequest with the given JSON body.
 * @param body - The request body object.
 * @returns A minimal fake NextRequest.
 */
function makeRequest(body: object): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

// A valid payload for a remote booking tomorrow (date must stay in the future relative to test run)
// Using a date far in advance ensures it doesn't accidentally become "past" during CI runs.
// The test bypasses validateBookingRequest's "too far in advance" check by using a date
// within 14 days - we rely on the mocked prisma/calendar to skip actual DB checks.
// For simplicity we re-use 2026-03-10 which is 1 day after the fixed NOW used in unit tests.
// In integration testing, "now" comes from `new Date()` inside the route, so we need a real
// future date. Use 2099-06-15 (well within the future) - validateBookingRequest will reject
// it as >14 days ahead. So we pick a date that falls within the next 14 days from when the
// tests actually run by computing it dynamically.
/**
 * Returns a dateKey (YYYY-MM-DD) that is 3 days from today in the Pacific/Auckland timezone.
 * @returns Date string 3 days from today.
 */
function futureDateKey(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d.toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
}

describe("POST /api/booking/request - success and error paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bookingFindMany.mockResolvedValue([]);
    mocks.fetchAllCalendarEvents.mockResolvedValue([]);
    mocks.contactUpsert.mockResolvedValue({ id: "contact-abc" });
    mocks.syncContactToGoogle.mockResolvedValue(undefined);
    mocks.sendOwnerBookingNotification.mockResolvedValue(undefined);
    mocks.sendCustomerBookingConfirmation.mockResolvedValue(undefined);
  });

  it("returns 500 when calendar event creation fails", async () => {
    mocks.createBookingEvent.mockRejectedValue(new Error("Calendar API down"));
    const req = makeRequest({
      name: "Alice",
      email: "alice@example.com",
      notes: "Fix my computer please",
      dateKey: futureDateKey(),
      timeOfDay: "10am",
      duration: "short",
      meetingType: "remote",
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/calendar/i);
  });

  it("returns ok:true with bookingId on successful booking", async () => {
    mocks.createBookingEvent.mockResolvedValue({ eventId: "cal-event-123" });
    mocks.bookingCreate.mockResolvedValue({
      id: "booking-abc",
      name: "Alice",
      email: "alice@example.com",
      notes: "Fix my computer please",
      startAt: new Date(),
      endAt: new Date(),
      cancelToken: "cancel-tok",
    });
    const req = makeRequest({
      name: "Alice",
      email: "alice@example.com",
      notes: "Fix my computer please",
      dateKey: futureDateKey(),
      timeOfDay: "10am",
      duration: "short",
      meetingType: "remote",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.bookingId).toBe("booking-abc");
  });

  it("returns 409 when a concurrent booking conflict (P2002) occurs", async () => {
    mocks.createBookingEvent.mockResolvedValue({ eventId: "cal-event-456" });
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.0.0",
    });
    mocks.bookingCreate.mockRejectedValue(p2002);
    const req = makeRequest({
      name: "Alice",
      email: "alice@example.com",
      notes: "Fix my computer please",
      dateKey: futureDateKey(),
      timeOfDay: "10am",
      duration: "short",
      meetingType: "remote",
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/no longer available/i);
  });

  it("upserts a contact with name, email, phone, and address on successful booking", async () => {
    mocks.createBookingEvent.mockResolvedValue({ eventId: "cal-event-123" });
    mocks.bookingCreate.mockResolvedValue({
      id: "booking-abc",
      name: "Alice",
      email: "alice@example.com",
      notes: "",
      startAt: new Date(),
      endAt: new Date(),
      cancelToken: "cancel-tok",
    });
    const req = makeRequest({
      name: "Alice",
      email: "ALICE@example.com",
      phone: "021 111 2222",
      address: "1 Main St, Auckland",
      notes: "Fix printer",
      dateKey: futureDateKey(),
      timeOfDay: "10am",
      duration: "short",
      meetingType: "in-person",
    });
    await POST(req);
    expect(mocks.contactUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "alice@example.com" },
        create: expect.objectContaining({ email: "alice@example.com", phone: "021 111 2222" }),
        update: expect.objectContaining({ phone: "021 111 2222" }),
      }),
    );
  });

  it("still returns ok:true even if contact upsert throws", async () => {
    mocks.createBookingEvent.mockResolvedValue({ eventId: "cal-event-789" });
    mocks.bookingCreate.mockResolvedValue({
      id: "booking-xyz",
      name: "Bob",
      email: "bob@example.com",
      notes: "",
      startAt: new Date(),
      endAt: new Date(),
      cancelToken: "cancel-tok2",
    });
    mocks.contactUpsert.mockRejectedValue(new Error("Contact DB error"));
    const req = makeRequest({
      name: "Bob",
      email: "bob@example.com",
      notes: "Help with laptop",
      dateKey: futureDateKey(),
      timeOfDay: "10am",
      duration: "short",
      meetingType: "remote",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});
