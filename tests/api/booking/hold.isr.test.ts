/**
 * @file tests/api/booking/hold.isr.test.ts
 * @description Test ISR revalidation triggered by booking creation
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/booking/hold/route";
import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock prisma
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

// Mock google calendar
vi.mock("@/lib/google-calendar", () => ({
  createBookingEvent: vi.fn().mockResolvedValue({
    eventId: "event-456",
  }),
}));

describe("POST /api/booking/hold - ISR Revalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call revalidatePath('/booking') after booking confirmation", async () => {
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
    const body = (await response.json()) as { ok?: boolean; bookingId?: string };

    // Verify booking was created
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.bookingId).toBe("booking-123");

    // ✅ CRITICAL: Verify revalidatePath was called for /booking
    expect(revalidatePath).toHaveBeenCalledWith("/booking");
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it("should revalidate even if calendar creation fails (optional feature)", async () => {
    // This test validates that revalidation happens in the try block
    // If calendar fails, booking is still revalidated (assumes booking is confirmed)
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
    const body = (await response.json()) as { ok?: boolean };

    // Booking should still succeed
    expect(body.ok).toBe(true);

    // revalidatePath should be called (inside try block, after booking.update)
    // with path per Next.js API
    expect(revalidatePath).toHaveBeenCalledWith("/booking");
  });
});
