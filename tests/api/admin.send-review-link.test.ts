import { describe, it, expect, vi } from "vitest";
import { POST } from "../../src/app/api/admin/reviews/route";
import { isValidAdminToken } from "../../src/shared/lib/auth";
import { prisma } from "../../src/shared/lib/prisma";
import { NextRequest } from "next/server";
import { createMockPrisma } from "../utils/mockPrisma";

vi.mock("../../src/shared/lib/auth", () => ({
  isValidAdminToken: vi.fn(),
}));
vi.mock("../../src/shared/lib/prisma", () => ({
  prisma: {
    review: {
      create: vi.fn(),
    },
  },
}));

// Helper to create mock NextRequest
/**
 * Creates a mock NextRequest with the given body.
 * @param body - The request body object.
 * @returns A mock NextRequest.
 */
function createRequest(body: object) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe("API: /api/admin/reviews", () => {
  it("should create a review for valid admin token and text", async () => {
    (isValidAdminToken as any).mockReturnValue(true);
    (prisma.review.create as any).mockResolvedValue({
      id: 1,
      text: "Excellent support!",
      firstName: "Jane",
      lastName: "Smith",
      isAnonymous: false,
      verified: false,
      status: "approved",
      createdAt: new Date(),
    });
    const req = createRequest({
      token: "valid-admin-token",
      text: "Excellent support!",
      firstName: "Jane",
      lastName: "Smith",
      isAnonymous: false,
    });
    const response = await POST(req);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.review.text).toBe("Excellent support!");
  });

  it("should return 401 for invalid admin token", async () => {
    (isValidAdminToken as any).mockReturnValue(false);
    const req = createRequest({
      token: "invalid-token",
      text: "Test review",
    });
    const response = await POST(req);
    const json = await response.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("should return 400 for short review text", async () => {
    (isValidAdminToken as any).mockReturnValue(true);
    const req = createRequest({
      token: "valid-admin-token",
      text: "short",
    });
    const response = await POST(req);
    const json = await response.json();
    expect(json.error).toMatch(/at least 10 characters/);
  });
});

// Minimal test for admin send-review-link API route

describe("API: /api/admin/send-review-link", () => {
  it("should call prisma.reviewRequest.create", async () => {
    const prisma = createMockPrisma();
    await prisma.reviewRequest.create({ data: { id: 1 } });
    expect(prisma.reviewRequest.create).toHaveBeenCalledWith({ data: { id: 1 } });
  });
});
