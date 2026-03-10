import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mocks must be declared before imports that use them
const mocks = vi.hoisted(() => ({
  bookingFindMany: vi.fn(),
  bookingCreate: vi.fn(),
  fetchAllCalendarEvents: vi.fn(),
  createBookingEvent: vi.fn(),
  sendOwnerBookingNotification: vi.fn(),
  sendCustomerBookingConfirmation: vi.fn(),
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: mocks.bookingFindMany,
      create: mocks.bookingCreate,
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

import { POST } from "../../src/app/api/booking/request/route";

/**
 * Creates a fake NextRequest with the given JSON body.
 * @param body - The request body object.
 * @returns A minimal fake NextRequest.
 */
function makeRequest(body: object): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe("POST /api/booking/request — input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bookingFindMany.mockResolvedValue([]);
    mocks.fetchAllCalendarEvents.mockResolvedValue([]);
  });

  it("returns 400 when name is missing", async () => {
    const req = makeRequest({
      email: "a@b.com",
      notes: "help",
      dateKey: "2026-03-10",
      timeOfDay: "10am",
      duration: "short",
      meetingType: "remote",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Name is required/);
  });

  it("returns 400 when email is missing", async () => {
    const req = makeRequest({
      name: "Alice",
      notes: "help",
      dateKey: "2026-03-10",
      timeOfDay: "10am",
      duration: "short",
      meetingType: "remote",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/email/i);
  });

  it("returns 400 when email has no @", async () => {
    const req = makeRequest({
      name: "Alice",
      email: "notanemail",
      notes: "help",
      dateKey: "2026-03-10",
      timeOfDay: "10am",
      duration: "short",
      meetingType: "remote",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/email/i);
  });

  it("returns 400 when notes are missing", async () => {
    const req = makeRequest({
      name: "Alice",
      email: "a@b.com",
      dateKey: "2026-03-10",
      timeOfDay: "10am",
      duration: "short",
      meetingType: "remote",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/describe/i);
  });

  it("returns 400 when dateKey is missing", async () => {
    const req = makeRequest({
      name: "Alice",
      email: "a@b.com",
      notes: "help me",
      timeOfDay: "10am",
      duration: "short",
      meetingType: "remote",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/day and time/i);
  });

  it("returns 400 when duration is missing", async () => {
    const req = makeRequest({
      name: "Alice",
      email: "a@b.com",
      notes: "help me",
      dateKey: "2026-03-10",
      timeOfDay: "10am",
      meetingType: "remote",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/duration/i);
  });

  it("returns 400 when meetingType is missing", async () => {
    const req = makeRequest({
      name: "Alice",
      email: "a@b.com",
      notes: "help me",
      dateKey: "2026-03-10",
      timeOfDay: "10am",
      duration: "short",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/in-person or remote/i);
  });

  it("returns 400 when in-person meeting has no address", async () => {
    const req = makeRequest({
      name: "Alice",
      email: "a@b.com",
      notes: "help me",
      dateKey: "2026-03-10",
      timeOfDay: "10am",
      duration: "short",
      meetingType: "in-person",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Address/i);
  });

  it("returns 400 when the selected date is in the past", async () => {
    const req = makeRequest({
      name: "Alice",
      email: "a@b.com",
      notes: "help me",
      dateKey: "2020-01-01",
      timeOfDay: "10am",
      duration: "short",
      meetingType: "remote",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });
});
