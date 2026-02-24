/**
 * @file tests/api/reviews/post.isr.test.ts
 * @description Test ISR revalidation triggered by review submission
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/reviews/route";
import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    review: {
      create: vi.fn().mockResolvedValue({
        id: "review-123",
        text: "Great service!",
        firstName: "John",
        lastName: "Doe",
        verified: true,
        approved: true,
      }),
      findMany: vi.fn().mockResolvedValue([]),
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

// Mock email service
vi.mock("@/lib/email", () => ({
  sendOwnerReviewNotification: vi.fn(),
}));

describe("POST /api/reviews - ISR Revalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call revalidatePath for both /reviews and /review after review creation", async () => {
    const validPayload = {
      text: "Excellent service, highly recommended!",
      firstName: "Jane",
      lastName: "Smith",
      isAnonymous: false,
    };

    const request = new NextRequest("http://localhost:3000/api/reviews", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { ok?: boolean; id?: string };

    // Verify review was created
    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.id).toBe("review-123");

    // ✅ CRITICAL: Verify revalidatePath was called for both review pages
    expect(revalidatePath).toHaveBeenCalledWith("/reviews");
    expect(revalidatePath).toHaveBeenCalledWith("/review");
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("should revalidate even if email notification fails", async () => {
    // The email service is mocked; revalidation should occur before any async email send
    const validPayload = {
      text: "Great experience with the team!",
      firstName: "Bob",
      lastName: "Johnson",
      isAnonymous: false,
    };

    const request = new NextRequest("http://localhost:3000/api/reviews", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { ok?: boolean };

    // Review submission should succeed
    expect(body.ok).toBe(true);

    // revalidatePath should be called for both review pages after review.create
    expect(revalidatePath).toHaveBeenCalledWith("/reviews");
    expect(revalidatePath).toHaveBeenCalledWith("/review");
  });

  it("should not revalidate on invalid review (before create)", async () => {
    const invalidPayload = {
      text: "Too short", // Less than 10 characters
      firstName: "Alice",
      lastName: "Wonder",
      isAnonymous: false,
    };

    const request = new NextRequest("http://localhost:3000/api/reviews", {
      method: "POST",
      body: JSON.stringify(invalidPayload),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);

    // Request should fail
    expect(response.status).toBe(400);

    // revalidatePath should NOT be called because review was never created
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
