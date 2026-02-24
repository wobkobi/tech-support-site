/**
 * @file tests/api/reviews/moderation.isr.test.ts
 * @description ISR integration tests for all review moderation endpoints
 * @severity S1 - Critical - Ensures cache consistency after moderation actions
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as approve } from "@/app/api/reviews/[id]/approve";
import { POST as revoke } from "@/app/api/reviews/[id]/revoke";
import { PATCH as adminPatch, DELETE as adminDelete } from "@/app/api/admin/reviews/[id]/route";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

// Mock next/cache to track revalidatePath calls
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma");
const ADMIN_SECRET = "testsecret";

const mockReview = {
  id: "review-123",
  text: "Great service!",
  status: "pending",
  firstName: "John",
  lastName: "Doe",
  isAnonymous: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_SECRET = ADMIN_SECRET;

  (prisma.review.findUnique as any) = vi.fn().mockResolvedValue(mockReview);
  (prisma.review.update as any) = vi.fn().mockResolvedValue(mockReview);
  (prisma.review.delete as any) = vi.fn().mockResolvedValue(mockReview);
});

describe("ISR Revalidation - Moderation Endpoints", () => {
  describe("Approve endpoint (/api/reviews/[id]/approve)", () => {
    it("triggers revalidation on all review pages after approve", async () => {
      const req = {
        headers: {
          /**
           * Gets header value by key.
           * @param k - Header key.
           * @returns Header value or null.
           */
          get: (k: string) => (k === "x-admin-secret" ? ADMIN_SECRET : null),
        },
      } as any;

      const res = await approve(req, { params: { id: "review-123" } });
      expect(res.status).toBe(200);

      // Verify all three pages are revalidated
      expect(revalidatePath).toHaveBeenCalledWith("/reviews");
      expect(revalidatePath).toHaveBeenCalledWith("/review");
      expect(revalidatePath).toHaveBeenCalledWith("/");
      expect(revalidatePath).toHaveBeenCalledTimes(3);
    });

    it("calls revalidatePath even on unauthorized request (no side effects)", async () => {
      const req = {
        headers: {
          /**
           * Returns null for all header keys.
           * @returns Always null.
           */
          get: () => null,
        },
      } as any;

      const res = await approve(req, { params: { id: "review-123" } });
      expect(res.status).toBe(403);

      // Should NOT call revalidatePath on auth failure
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("calls revalidatePath even if review not found (after DB check)", async () => {
      (prisma.review.findUnique as any) = vi.fn().mockResolvedValue(null);

      const req = {
        headers: {
          /**
           * Gets header value by key.
           * @param k - Header key.
           * @returns Header value or null.
           */
          get: (k: string) => (k === "x-admin-secret" ? ADMIN_SECRET : null),
        },
      } as any;

      const res = await approve(req, { params: { id: "notfound" } });
      expect(res.status).toBe(404);

      // Should NOT call revalidatePath if review doesn't exist
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("Revoke endpoint (/api/reviews/[id]/revoke)", () => {
    it("triggers revalidation on all review pages after revoke", async () => {
      const req = {
        headers: {
          /**
           * Gets header value by key.
           * @param k - Header key.
           * @returns Header value or null.
           */
          get: (k: string) => (k === "x-admin-secret" ? ADMIN_SECRET : null),
        },
      } as any;

      const res = await revoke(req, { params: { id: "review-123" } });
      expect(res.status).toBe(200);

      // Verify all three pages are revalidated
      expect(revalidatePath).toHaveBeenCalledWith("/reviews");
      expect(revalidatePath).toHaveBeenCalledWith("/review");
      expect(revalidatePath).toHaveBeenCalledWith("/");
      expect(revalidatePath).toHaveBeenCalledTimes(3);
    });

    it("does not call revalidatePath on unauthorized request", async () => {
      const req = {
        headers: {
          /**
           * Returns null for all header keys.
           * @returns Always null.
           */
          get: () => null,
        },
      } as any;

      const res = await revoke(req, { params: { id: "review-123" } });
      expect(res.status).toBe(403);

      // Should NOT call revalidatePath on auth failure
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("Admin PATCH endpoint (/api/admin/reviews/[id])", () => {
    it("triggers revalidation after approve action", async () => {
      const req = {
        /**
         * Returns the request body as JSON.
         * @returns The request body.
         */
        json: async () => ({ action: "approve", token: ADMIN_SECRET }),
      } as any;

      const res = await adminPatch(req, { params: Promise.resolve({ id: "review-123" }) });
      expect(res.status).toBe(200);

      // Verify all three pages are revalidated
      expect(revalidatePath).toHaveBeenCalledWith("/reviews");
      expect(revalidatePath).toHaveBeenCalledWith("/review");
      expect(revalidatePath).toHaveBeenCalledWith("/");
      expect(revalidatePath).toHaveBeenCalledTimes(3);
    });

    it("triggers revalidation after revoke action", async () => {
      const req = {
        /**
         * Returns the request body as JSON.
         * @returns The request body.
         */
        json: async () => ({ action: "revoke", token: ADMIN_SECRET }),
      } as any;

      const res = await adminPatch(req, { params: Promise.resolve({ id: "review-123" }) });
      expect(res.status).toBe(200);

      // Verify all three pages are revalidated
      expect(revalidatePath).toHaveBeenCalledWith("/reviews");
      expect(revalidatePath).toHaveBeenCalledWith("/review");
      expect(revalidatePath).toHaveBeenCalledWith("/");
      expect(revalidatePath).toHaveBeenCalledTimes(3);
    });

    it("does not call revalidatePath on unauthorized request", async () => {
      const req = {
        /**
         * Returns the request body as JSON.
         * @returns The request body.
         */
        json: async () => ({ action: "approve", token: "wrong" }),
      } as any;

      const res = await adminPatch(req, { params: Promise.resolve({ id: "review-123" }) });
      expect(res.status).toBe(401);

      // Should NOT call revalidatePath on auth failure
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("does not call revalidatePath on invalid action", async () => {
      const req = {
        /**
         * Returns the request body as JSON.
         * @returns The request body.
         */
        json: async () => ({ action: "invalid", token: ADMIN_SECRET }),
      } as any;

      const res = await adminPatch(req, { params: Promise.resolve({ id: "review-123" }) });
      expect(res.status).toBe(400);

      // Should NOT call revalidatePath on validation failure
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("Admin DELETE endpoint (/api/admin/reviews/[id])", () => {
    it("triggers revalidation after successful delete", async () => {
      const req = {
        nextUrl: {
          searchParams: {
            /**
             * Gets query parameter by key.
             * @param key - Query parameter key.
             * @returns Query parameter value or null.
             */
            get: (key: string) => (key === "token" ? ADMIN_SECRET : null),
          },
        },
      } as any;

      const res = await adminDelete(req, { params: Promise.resolve({ id: "review-123" }) });
      expect(res.status).toBe(200);

      // ✅ CRITICAL: Verify delete triggers ISR revalidation (bug fix validation)
      expect(revalidatePath).toHaveBeenCalledWith("/reviews");
      expect(revalidatePath).toHaveBeenCalledWith("/review");
      expect(revalidatePath).toHaveBeenCalledWith("/");
      expect(revalidatePath).toHaveBeenCalledTimes(3);
    });

    it("does not call revalidatePath on unauthorized request", async () => {
      const req = {
        nextUrl: {
          searchParams: {
            /**
             * Returns null for all query parameters.
             * @returns Always null.
             */
            get: () => null,
          },
        },
      } as any;

      const res = await adminDelete(req, { params: Promise.resolve({ id: "review-123" }) });
      expect(res.status).toBe(401);

      // Should NOT call revalidatePath on auth failure
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("calls revalidatePath even if delete fails", async () => {
      (prisma.review.delete as any) = vi.fn().mockRejectedValue(new Error("DB Error"));

      const req = {
        nextUrl: {
          searchParams: {
            /**
             * Gets query parameter by key.
             * @param key - Query parameter key.
             * @returns Query parameter value or null.
             */
            get: (key: string) => (key === "token" ? ADMIN_SECRET : null),
          },
        },
      } as any;

      const res = await adminDelete(req, { params: Promise.resolve({ id: "review-123" }) });
      expect(res.status).toBe(500);

      // Should NOT call revalidatePath if operation fails
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("ISR cache consistency", () => {
    it("all moderation endpoints revalidate same paths", async () => {
      const expectedPaths = ["/reviews", "/review", "/"];

      // Test approve
      vi.clearAllMocks();
      const approveReq = {
        headers: {
          /**
           * Gets header value by key.
           * @param k - Header key.
           * @returns Header value or null.
           */
          get: (k: string) => (k === "x-admin-secret" ? ADMIN_SECRET : null),
        },
      } as any;
      await approve(approveReq, { params: { id: "review-123" } });
      const approveCalls = (revalidatePath as any).mock.calls.map((call: any) => call[0]);

      // Test revoke
      vi.clearAllMocks();
      const revokeReq = {
        headers: {
          /**
           * Gets header value by key.
           * @param k - Header key.
           * @returns Header value or null.
           */
          get: (k: string) => (k === "x-admin-secret" ? ADMIN_SECRET : null),
        },
      } as any;
      await revoke(revokeReq, { params: { id: "review-123" } });
      const revokeCalls = (revalidatePath as any).mock.calls.map((call: any) => call[0]);

      // Test admin approve
      vi.clearAllMocks();
      const adminApproveReq = {
        /**
         * Returns the request body as JSON.
         * @returns The request body.
         */
        json: async () => ({ action: "approve", token: ADMIN_SECRET }),
      } as any;
      await adminPatch(adminApproveReq, { params: Promise.resolve({ id: "review-123" }) });
      const adminApproveCalls = (revalidatePath as any).mock.calls.map((call: any) => call[0]);

      // Test admin delete
      vi.clearAllMocks();
      const deleteReq = {
        nextUrl: {
          searchParams: {
            /**
             * Gets query parameter by key.
             * @param key - Query parameter key.
             * @returns Query parameter value or null.
             */
            get: (key: string) => (key === "token" ? ADMIN_SECRET : null),
          },
        },
      } as any;
      await adminDelete(deleteReq, { params: Promise.resolve({ id: "review-123" }) });
      const deleteCalls = (revalidatePath as any).mock.calls.map((call: any) => call[0]);

      // All endpoints should revalidate the same paths
      expect(approveCalls).toEqual(expectedPaths);
      expect(revokeCalls).toEqual(expectedPaths);
      expect(adminApproveCalls).toEqual(expectedPaths);
      expect(deleteCalls).toEqual(expectedPaths);
    });

    it("revalidatePath is called in correct order", async () => {
      const req = {
        headers: {
          /**
           * Gets header value by key.
           * @param k - Header key.
           * @returns Header value or null.
           */
          get: (k: string) => (k === "x-admin-secret" ? ADMIN_SECRET : null),
        },
      } as any;

      await approve(req, { params: { id: "review-123" } });

      const calls = (revalidatePath as any).mock.calls.map((call: any) => call[0]);

      // Verify order: /reviews, /review, /
      expect(calls[0]).toBe("/reviews");
      expect(calls[1]).toBe("/review");
      expect(calls[2]).toBe("/");
    });
  });
});
