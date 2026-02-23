/**
 * @file tests/api/reviews/post.edge-cases.test.ts
 * @description Edge case tests for review submission endpoint
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/reviews/route";
import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";
import type { Booking } from "@prisma/client";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    review: {
      create: vi.fn().mockResolvedValue({
        id: "review-123",
        text: "Great service!",
        verified: true,
        approved: true,
      }),
    },
    booking: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ id: "booking-456" }),
    },
    reviewRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ id: "request-789" }),
    },
  },
}));

vi.mock("@/lib/email", () => ({
  sendOwnerReviewNotification: vi.fn(),
}));

describe("POST /api/reviews - Edge Cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error if revalidatePath throws (not caught)", async () => {
    const { revalidatePath: mockRevalidate } = await import("next/cache");
    // Throw on first call
    vi.mocked(mockRevalidate).mockImplementationOnce(() => {
      throw new Error("Revalidation failed");
    });

    const validPayload = {
      text: "Excellent service!",
      firstName: "James",
      lastName: "Wilson",
      isAnonymous: false,
    };

    const request = new NextRequest("http://localhost:3000/api/reviews", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);

    // revalidatePath is not wrapped in try/catch, so it throws and cause 500
    expect(response.status).toBe(500);
  });

  it("creates review even if email notification fails", async () => {
    const { sendOwnerReviewNotification } = await import("@/lib/email");
    vi.mocked(sendOwnerReviewNotification).mockRejectedValueOnce(new Error("Email service error"));

    const validPayload = {
      text: "Very good experience overall!",
      firstName: "Katherine",
      lastName: "Davis",
      isAnonymous: false,
    };

    const request = new NextRequest("http://localhost:3000/api/reviews", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { ok?: boolean };

    // Review should succeed despite email failure (fire-and-forget)
    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
  });

  it("validates review text minimum length", async () => {
    const tooShort = {
      text: "Ok",
      firstName: "Earl",
      lastName: "Harris",
      isAnonymous: false,
    };

    const request = new NextRequest("http://localhost:3000/api/reviews", {
      method: "POST",
      body: JSON.stringify(tooShort),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("at least 10 characters");
  });

  it("validates review text maximum length", async () => {
    const tooLong = {
      text: "A".repeat(601),
      firstName: "Frank",
      lastName: "Miller",
      isAnonymous: false,
    };

    const request = new NextRequest("http://localhost:3000/api/reviews", {
      method: "POST",
      body: JSON.stringify(tooLong),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("600 characters");
  });

  it("requires first name when not anonymous", async () => {
    const noName = {
      text: "Great service provided!",
      firstName: "",
      lastName: "Hernandez",
      isAnonymous: false,
    };

    const request = new NextRequest("http://localhost:3000/api/reviews", {
      method: "POST",
      body: JSON.stringify(noName),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("First name");
  });

  it("allows anonymous review without name", async () => {
    const anonPayload = {
      text: "Fantastic experience and highly appreciated!",
      isAnonymous: true,
    };

    const request = new NextRequest("http://localhost:3000/api/reviews", {
      method: "POST",
      body: JSON.stringify(anonPayload),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { ok?: boolean };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
  });

  it("handles invalid token gracefully", async () => {
    const { prisma } = await import("@/lib/prisma");
    // Token doesn't match any booking or request
    vi.mocked(prisma.booking.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.reviewRequest.findFirst).mockResolvedValueOnce(null);

    const validated = {
      text: "Wonderful service received!",
      firstName: "Iris",
      lastName: "Jackson",
      isAnonymous: false,
      bookingId: "invalid-id",
      reviewToken: "invalid-token",
    };

    const request = new NextRequest("http://localhost:3000/api/reviews", {
      method: "POST",
      body: JSON.stringify(validated),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { ok?: boolean; verified?: boolean };

    // Review is created but marked as unverified
    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.verified).toBe(false);
  });

  it("verifies review with valid booking token", async () => {
    const { prisma } = await import("@/lib/prisma");
    const mockBooking: Partial<Booking> = {
      id: "booking-456",
      reviewToken: "valid-token-123",
      name: "Tom",
      reviewSubmittedAt: null,
    };
    vi.mocked(prisma.booking.findFirst).mockResolvedValueOnce(mockBooking as Booking);
    vi.mocked(prisma.booking.update).mockResolvedValueOnce({
      ...mockBooking,
      reviewSubmittedAt: new Date(),
    } as Booking);

    const verified = {
      text: "Phenomenal service and wonderful staff!",
      firstName: "Tom",
      lastName: "King",
      isAnonymous: false,
      bookingId: "booking-456",
      reviewToken: "valid-token-123",
    };

    const request = new NextRequest("http://localhost:3000/api/reviews", {
      method: "POST",
      body: JSON.stringify(verified),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { ok?: boolean; verified?: boolean };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.verified).toBe(true);
  });

  it("calls revalidatePath for both /reviews and /review", async () => {
    const invalidPayload = {
      text: "Satisfactory service quality!",
      firstName: "Lucy",
      lastName: "Lopez",
      isAnonymous: false,
    };

    const request = new NextRequest("http://localhost:3000/api/reviews", {
      method: "POST",
      body: JSON.stringify(invalidPayload),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(revalidatePath).toHaveBeenCalledWith("/reviews");
    expect(revalidatePath).toHaveBeenCalledWith("/review");
  });
});
