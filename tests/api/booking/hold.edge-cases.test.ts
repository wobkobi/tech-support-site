/**
 * @file tests/api/booking/hold.edge-cases.test.ts
 * @description Edge case tests for booking hold endpoint
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/booking/hold/route";
import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      create: vi.fn().mockResolvedValue({
        id: "booking-123",
        status: "held",
        startUtc: new Date("2026-03-01T14:00:00Z"),
        endUtc: new Date("2026-03-01T15:00:00Z"),
      }),
      update: vi.fn().mockResolvedValue({
        id: "booking-123",
        status: "confirmed",
        calendarEventId: "event-456",
      }),
    },
  },
}));

vi.mock("@/lib/google-calendar", () => ({
  createBookingEvent: vi.fn().mockResolvedValue({
    eventId: "event-456",
  }),
}));

describe("POST /api/booking/hold - Edge Cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("succeeds even if revalidatePath throws error", async () => {
    const { revalidatePath: mockRevalidate } = await import("next/cache");
    vi.mocked(mockRevalidate).mockImplementationOnce(() => {
      throw new Error("Revalidation failed");
    });

    const validPayload = {
      name: "John Doe",
      email: "john@example.com",
      phone: "555-1234",
      dateKey: "2026-03-01",
      slotStart: "14:00",
      slotEnd: "15:00",
      meetingType: "remote",
    };

    const request = new NextRequest("http://localhost:3000/api/booking/hold", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { ok?: boolean };

    // Booking should still succeed even if revalidation fails
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("creates booking even if calendar event creation fails", async () => {
    const { createBookingEvent } = await import("@/lib/google-calendar");
    vi.mocked(createBookingEvent).mockRejectedValueOnce(new Error("Calendar API error"));

    const validPayload = {
      name: "Jane Smith",
      email: "jane@example.com",
      dateKey: "2026-03-02",
      slotStart: "10:00",
      slotEnd: "11:00",
      meetingType: "in-person",
      address: "123 Main St, Auckland",
    };

    const request = new NextRequest("http://localhost:3000/api/booking/hold", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { ok?: boolean; bookingId?: string };

    // Booking should succeed despite calendar failure
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.bookingId).toBe("booking-123");
  });

  it("does not call revalidatePath if calendar creation fails (exception before update)", async () => {
    const { createBookingEvent } = await import("@/lib/google-calendar");

    // Make calendar fail on first call (before prisma.booking.update)
    vi.mocked(createBookingEvent).mockRejectedValueOnce(new Error("Calendar API error"));

    const validPayload = {
      name: "Bob Johnson",
      email: "bob@example.com",
      dateKey: "2026-03-03",
      slotStart: "14:00",
      slotEnd: "15:00",
      meetingType: "remote",
    };

    const request = new NextRequest("http://localhost:3000/api/booking/hold", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { ok?: boolean };

    // Booking still succeeds (created in DB before calendar attempt)
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);

    // revalidatePath should NOT have been called because exception occurs
    // before prisma.booking.update in the try block
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects invalid email format", async () => {
    const invalidPayload = {
      name: "Alice",
      email: "not-an-email",
      dateKey: "2026-04-01",
      slotStart: "10:00",
      slotEnd: "11:00",
      meetingType: "remote",
    };

    const request = new NextRequest("http://localhost:3000/api/booking/hold", {
      method: "POST",
      body: JSON.stringify(invalidPayload),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("Valid email");
  });

  it("rejects booking in the past", async () => {
    const pastPayload = {
      name: "Charlie Brown",
      email: "charlie@example.com",
      dateKey: "2020-01-01", // Past date
      slotStart: "10:00",
      slotEnd: "11:00",
      meetingType: "remote",
    };

    const request = new NextRequest("http://localhost:3000/api/booking/hold", {
      method: "POST",
      body: JSON.stringify(pastPayload),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("past");
  });

  it("rejects in-person booking without address", async () => {
    const invalidPayload = {
      name: "Diana Prince",
      email: "diana@example.com",
      dateKey: "2026-05-01",
      slotStart: "14:00",
      slotEnd: "15:00",
      meetingType: "in-person",
      // Missing address
    };

    const request = new NextRequest("http://localhost:3000/api/booking/hold", {
      method: "POST",
      body: JSON.stringify(invalidPayload),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("Address");
  });
});
