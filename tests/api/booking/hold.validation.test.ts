import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/booking/hold/route";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma");
vi.mock("@/lib/google-calendar");
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import * as googleCalendar from "@/lib/google-calendar";

const mockPrisma = prisma as any;
const mockGoogleCalendar = googleCalendar as any;

describe("POST /api/booking/hold - Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Initialize mock functions
    mockPrisma.booking = {
      create: vi.fn(),
      update: vi.fn(),
    };
    mockGoogleCalendar.createBookingEvent = vi.fn();
  });

  // ===== INPUT VALIDATION TESTS =====

  describe("Input validation", () => {
    it("returns 400 when name is missing", async () => {
      const request = new NextRequest("http://localhost:3000/api/booking/hold", {
        method: "POST",
        body: JSON.stringify({
          name: "",
          email: "test@example.com",
          dateKey: "2026-02-25",
          slotStart: "10:00",
          slotEnd: "11:00",
          meetingType: "remote",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Name is required");
    });

    it("returns 400 when email is missing", async () => {
      const request = new NextRequest("http://localhost:3000/api/booking/hold", {
        method: "POST",
        body: JSON.stringify({
          name: "John Doe",
          email: "",
          dateKey: "2026-02-25",
          slotStart: "10:00",
          slotEnd: "11:00",
          meetingType: "remote",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Valid email is required");
    });

    it("returns 400 when email is invalid", async () => {
      const request = new NextRequest("http://localhost:3000/api/booking/hold", {
        method: "POST",
        body: JSON.stringify({
          name: "John Doe",
          email: "not-an-email",
          dateKey: "2026-02-25",
          slotStart: "10:00",
          slotEnd: "11:00",
          meetingType: "remote",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Valid email is required");
    });

    it("returns 400 when dateKey is missing", async () => {
      const request = new NextRequest("http://localhost:3000/api/booking/hold", {
        method: "POST",
        body: JSON.stringify({
          name: "John Doe",
          email: "john@example.com",
          dateKey: "",
          slotStart: "10:00",
          slotEnd: "11:00",
          meetingType: "remote",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Please select a time slot");
    });

    it("returns 400 when slotStart is missing", async () => {
      const request = new NextRequest("http://localhost:3000/api/booking/hold", {
        method: "POST",
        body: JSON.stringify({
          name: "John Doe",
          email: "john@example.com",
          dateKey: "2026-02-25",
          slotStart: "",
          slotEnd: "11:00",
          meetingType: "remote",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Please select a time slot");
    });

    it("returns 400 when meetingType is missing", async () => {
      const request = new NextRequest("http://localhost:3000/api/booking/hold", {
        method: "POST",
        body: JSON.stringify({
          name: "John Doe",
          email: "john@example.com",
          dateKey: "2026-02-25",
          slotStart: "10:00",
          slotEnd: "11:00",
          meetingType: "",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Please select in-person or remote");
    });

    it("returns 400 when in-person without address", async () => {
      const request = new NextRequest("http://localhost:3000/api/booking/hold", {
        method: "POST",
        body: JSON.stringify({
          name: "John Doe",
          email: "john@example.com",
          dateKey: "2026-02-25",
          slotStart: "10:00",
          slotEnd: "11:00",
          meetingType: "in-person",
          address: "",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Address is required");
    });

    it("returns 400 when time range is invalid (start >= end)", async () => {
      const request = new NextRequest("http://localhost:3000/api/booking/hold", {
        method: "POST",
        body: JSON.stringify({
          name: "John Doe",
          email: "john@example.com",
          dateKey: "2026-02-25",
          slotStart: "15:00",
          slotEnd: "14:00",
          meetingType: "remote",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid time range");
    });
  });

  // ===== SUCCESSFUL BOOKING TESTS =====

  describe("Successful booking", () => {
    it("creates booking with remote meeting type", async () => {
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z"));

      mockPrisma.booking.create.mockResolvedValue({
        id: "booking-1",
        status: "held",
        cancelToken: "token-123",
        email: "john@example.com",
      });

      mockGoogleCalendar.createBookingEvent.mockResolvedValue({
        eventId: "event-123",
      });

      const request = new NextRequest("http://localhost:3000/api/booking/hold", {
        method: "POST",
        body: JSON.stringify({
          name: "John Doe",
          email: "john@example.com",
          dateKey: "2026-02-25",
          slotStart: "10:00",
          slotEnd: "11:00",
          meetingType: "remote",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.bookingId).toBeDefined();
    });

    it("includes address in notes for in-person meeting", async () => {
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z"));

      mockPrisma.booking.create.mockResolvedValue({
        id: "booking-1",
        status: "held",
        cancelToken: "token-123",
      });

      mockGoogleCalendar.createBookingEvent.mockResolvedValue({
        eventId: "event-123",
      });

      const request = new NextRequest("http://localhost:3000/api/booking/hold", {
        method: "POST",
        body: JSON.stringify({
          name: "John Doe",
          email: "john@example.com",
          dateKey: "2026-02-25",
          slotStart: "10:00",
          slotEnd: "11:00",
          meetingType: "in-person",
          address: "123 Main St",
        }),
      });

      await POST(request);

      // Verify notes contain address
      const createCall = mockPrisma.booking.create.mock.calls[0];
      expect(createCall[0].data.notes).toContain("Address: 123 Main St");
    });

    it("returns 200 when calendar api fails (non-blocking)", async () => {
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z"));

      mockPrisma.booking.create.mockResolvedValue({
        id: "booking-1",
        status: "held",
      });

      mockGoogleCalendar.createBookingEvent.mockRejectedValue(new Error("Calendar API error"));

      const request = new NextRequest("http://localhost:3000/api/booking/hold", {
        method: "POST",
        body: JSON.stringify({
          name: "John Doe",
          email: "john@example.com",
          dateKey: "2026-02-25",
          slotStart: "10:00",
          slotEnd: "11:00",
          meetingType: "remote",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
    });
  });

  // ===== EDGE CASES =====

  describe("Edge cases", () => {
    it("lowercases and trims email before storage", async () => {
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z"));

      mockPrisma.booking.create.mockResolvedValue({
        id: "booking-1",
      });

      mockGoogleCalendar.createBookingEvent.mockResolvedValue({
        eventId: "event-123",
      });

      const request = new NextRequest("http://localhost:3000/api/booking/hold", {
        method: "POST",
        body: JSON.stringify({
          name: "John Doe",
          email: "  JOHN@EXAMPLE.COM  ",
          dateKey: "2026-02-25",
          slotStart: "10:00",
          slotEnd: "11:00",
          meetingType: "remote",
        }),
      });

      await POST(request);

      const createCall = mockPrisma.booking.create.mock.calls[0];
      expect(createCall[0].data.email).toBe("john@example.com");
    });

    it("creates booking with status held (not confirmed)", async () => {
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z"));

      mockPrisma.booking.create.mockResolvedValue({
        id: "booking-1",
        status: "held",
      });

      mockGoogleCalendar.createBookingEvent.mockResolvedValue({
        eventId: "event-123",
      });

      const request = new NextRequest("http://localhost:3000/api/booking/hold", {
        method: "POST",
        body: JSON.stringify({
          name: "John Doe",
          email: "john@example.com",
          dateKey: "2026-02-25",
          slotStart: "10:00",
          slotEnd: "11:00",
          meetingType: "remote",
        }),
      });

      await POST(request);

      const createCall = mockPrisma.booking.create.mock.calls[0];
      expect(createCall[0].data.status).toBe("held");
    });

    it("sets holdExpiresUtc to 15 minutes from now", async () => {
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z"));

      mockPrisma.booking.create.mockResolvedValue({
        id: "booking-1",
      });

      mockGoogleCalendar.createBookingEvent.mockResolvedValue({
        eventId: "event-123",
      });

      const request = new NextRequest("http://localhost:3000/api/booking/hold", {
        method: "POST",
        body: JSON.stringify({
          name: "John Doe",
          email: "john@example.com",
          dateKey: "2026-02-25",
          slotStart: "10:00",
          slotEnd: "11:00",
          meetingType: "remote",
        }),
      });

      await POST(request);

      const createCall = mockPrisma.booking.create.mock.calls[0];
      const holdExpiresUtc = createCall[0].data.holdExpiresUtc;
      const now = new Date("2026-02-24T10:00:00.000Z");
      const expected = new Date(now.getTime() + 15 * 60 * 1000);

      expect(holdExpiresUtc.getTime()).toBe(expected.getTime());
    });
  });

  // ===== CONCURRENT BOOKING CONFLICT TESTS =====

  describe("Concurrent booking prevention", () => {
    it("returns 409 when activeSlotKey constraint is violated (P2002)", async () => {
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z"));

      // Simulate Prisma unique constraint violation
      const p2002Error = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6.0.0",
      });

      mockPrisma.booking.create.mockRejectedValue(p2002Error);

      const request = new NextRequest("http://localhost:3000/api/booking/hold", {
        method: "POST",
        body: JSON.stringify({
          name: "John Doe",
          email: "john@example.com",
          dateKey: "2026-02-25",
          slotStart: "10:00",
          slotEnd: "11:00",
          meetingType: "remote",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.error).toContain("no longer available");
    });

    it("returns 500 for other database errors (not P2002)", async () => {
      vi.setSystemTime(new Date("2026-02-24T10:00:00.000Z"));

      // Simulate other database error
      const genericError = new Error("Database connection failed");
      mockPrisma.booking.create.mockRejectedValue(genericError);

      const request = new NextRequest("http://localhost:3000/api/booking/hold", {
        method: "POST",
        body: JSON.stringify({
          name: "John Doe",
          email: "john@example.com",
          dateKey: "2026-02-25",
          slotStart: "10:00",
          slotEnd: "11:00",
          meetingType: "remote",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Failed to create booking");
    });
  });
});
