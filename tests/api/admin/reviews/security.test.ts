/**
 * @file tests/api/admin/reviews/security.test.ts
 * @description Security tests for admin review moderation endpoints
 * @severity S1 - Critical - Security vulnerabilities in admin authentication
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH, DELETE } from "@/app/api/admin/reviews/[id]/route";
import { POST } from "@/app/api/admin/reviews/route";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma");
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const ADMIN_SECRET = "testsecret";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_SECRET = ADMIN_SECRET;

  (prisma.review.update as any) = vi.fn().mockResolvedValue({ id: "review-123" });
  (prisma.review.delete as any) = vi.fn().mockResolvedValue({ id: "review-123" });
  (prisma.review.create as any) = vi.fn().mockResolvedValue({ id: "review-new" });
});

/**
 * Helper to create a PATCH request
 * @param action - "approve" or "revoke"
 * @param token - Admin token
 * @returns Mock request object
 */
function makePatchRequest(action: string, token: string | null): any {
  return {
    /**
     * Returns the request body as JSON.
     * @returns The request body.
     */
    json: async () => ({ action, token }),
  } as any;
}

/**
 * Helper to create a DELETE request
 * @param token - Admin token (query param)
 * @returns Mock request object
 */
function makeDeleteRequest(token: string | null): any {
  return {
    nextUrl: {
      searchParams: {
        /**
         * Gets query parameter by key.
         * @param key - Query parameter key.
         * @returns Query parameter value or null.
         */
        get: (key: string) => (key === "token" ? token : null),
      },
    },
  } as any;
}

/**
 * Helper to create a POST request
 * @param body - Request body
 * @returns Mock request object
 */
function makePostRequest(body: any): any {
  return {
    /**
     * Returns the request body as JSON.
     * @returns The request body.
     */
    json: async () => body,
  } as any;
}

describe("Admin Security - Token Brute Force Protection", () => {
  it("handles 100 rapid auth failures without performance degradation", async () => {
    const startTime = performance.now();
    const promises = [];

    // Simulate 100 rapid failed auth attempts
    for (let i = 0; i < 100; i++) {
      const req = makePatchRequest("approve", `wrong-token-${i}`);
      promises.push(PATCH(req, { params: Promise.resolve({ id: "review-123" }) }));
    }

    const results = await Promise.all(promises);
    const endTime = performance.now();

    // All should fail with 401
    results.forEach((res) => {
      expect(res.status).toBe(401);
    });

    // Should complete in reasonable time (<5 seconds for 100 requests)
    expect(endTime - startTime).toBeLessThan(5000);

    // Database should never be called
    expect(prisma.review.update).not.toHaveBeenCalled();
  });

  it("maintains consistent response time for correct vs incorrect tokens", async () => {
    const timings: number[] = [];

    // Test 10 times with wrong tokens
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const req = makePatchRequest("approve", "wrong-token");
      await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });
      timings.push(performance.now() - start);
    }

    // Test 10 times with correct token
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const req = makePatchRequest("approve", ADMIN_SECRET);
      await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });
      timings.push(performance.now() - start);
    }

    // Calculate average and variance
    const avg = timings.reduce((a, b) => a + b) / timings.length;
    const variance =
      timings.reduce((sum, time) => sum + Math.pow(time - avg, 2), 0) / timings.length;
    const stdDev = Math.sqrt(variance);

    // Standard deviation should be low (timing-safe comparison)
    // Allow up to 50ms deviation for test environment noise
    expect(stdDev).toBeLessThan(50);
  });
});

describe("Admin Security - Token Edge Cases", () => {
  it("rejects empty string token", async () => {
    const req = makePatchRequest("approve", "");
    const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });

    expect(res.status).toBe(401);
    expect(prisma.review.update).not.toHaveBeenCalled();
  });

  it("rejects null token", async () => {
    const req = makePatchRequest("approve", null);
    const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });

    expect(res.status).toBe(401);
    expect(prisma.review.update).not.toHaveBeenCalled();
  });

  it("rejects undefined token (missing from body)", async () => {
    const req = {
      /**
       * Returns the request body as JSON.
       * @returns The request body.
       */
      json: async () => ({ action: "approve" }),
    } as any;
    const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });

    expect(res.status).toBe(401);
    expect(prisma.review.update).not.toHaveBeenCalled();
  });

  it("handles very long token without crashing", async () => {
    const hugeToken = "A".repeat(100000); // 100KB token
    const req = makePatchRequest("approve", hugeToken);

    const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });

    expect(res.status).toBe(401);
    expect(prisma.review.update).not.toHaveBeenCalled();
  });

  it("handles token with null bytes", async () => {
    const maliciousToken = "valid\x00secret";
    const req = makePatchRequest("approve", maliciousToken);

    const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });

    expect(res.status).toBe(401);
    expect(prisma.review.update).not.toHaveBeenCalled();
  });

  it("handles token with unicode characters", async () => {
    const unicodeToken = "valid😀secret";
    const req = makePatchRequest("approve", unicodeToken);

    const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });

    expect(res.status).toBe(401);
    expect(prisma.review.update).not.toHaveBeenCalled();
  });

  it("distinguishes tokens that differ by single character", async () => {
    const wrongToken = ADMIN_SECRET.slice(0, -1) + "X"; // Last char different
    const req = makePatchRequest("approve", wrongToken);

    const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });

    expect(res.status).toBe(401);
    expect(prisma.review.update).not.toHaveBeenCalled();
  });
});

describe("Admin Security - XSS/Injection Protection", () => {
  it("handles XSS payload in review text (POST /api/admin/reviews)", async () => {
    const xssPayload = '<script>alert("XSS")</script>';
    const req = makePostRequest({
      token: ADMIN_SECRET,
      text: xssPayload,
      firstName: "Test",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // Verify Prisma received the raw payload (React/Next.js escapes on render)
    expect(prisma.review.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          text: xssPayload,
        }),
      }),
    );
  });

  it("handles SQL-like strings safely", async () => {
    const sqlPayload = "'; DROP TABLE reviews; --";
    const req = makePostRequest({
      token: ADMIN_SECRET,
      text: sqlPayload,
      firstName: "Test",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // Prisma parameterizes queries, so this is safe
    expect(prisma.review.create).toHaveBeenCalled();
  });

  it("handles HTML injection in names", async () => {
    const htmlPayload = '<img src=x onerror="alert(1)">';
    const req = makePostRequest({
      token: ADMIN_SECRET,
      text: "Valid review text here",
      firstName: htmlPayload,
      lastName: htmlPayload,
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // Names should be stored as-is, escaped on render
    expect(prisma.review.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          firstName: htmlPayload,
          lastName: htmlPayload,
        }),
      }),
    );
  });

  it("handles extremely long XSS payload (10KB)", async () => {
    const hugeXSS = "<script>alert('XSS')</script>".repeat(350); // ~10KB
    const req = makePostRequest({
      token: ADMIN_SECRET,
      text: hugeXSS.substring(0, 600), // Text limit is 600
      firstName: "Test",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
  });
});

describe("Admin Security - ADMIN_SECRET Environment Variable", () => {
  it("rejects all requests when ADMIN_SECRET is not set", async () => {
    delete process.env.ADMIN_SECRET;

    const req = makePatchRequest("approve", "any-token");
    const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });

    expect(res.status).toBe(401);
    expect(prisma.review.update).not.toHaveBeenCalled();

    // Restore for other tests
    process.env.ADMIN_SECRET = ADMIN_SECRET;
  });

  it("rejects all requests when ADMIN_SECRET is empty string", async () => {
    process.env.ADMIN_SECRET = "";

    const req = makePatchRequest("approve", "any-token");
    const res = await PATCH(req, { params: Promise.resolve({ id: "review-123" }) });

    expect(res.status).toBe(401);
    expect(prisma.review.update).not.toHaveBeenCalled();

    // Restore for other tests
    process.env.ADMIN_SECRET = ADMIN_SECRET;
  });
});

describe("Admin Security - DELETE Endpoint Token Handling", () => {
  it("rejects DELETE with token in body instead of query param", async () => {
    const req = {
      /**
       * Returns the request body as JSON.
       * @returns The request body.
       */
      json: async () => ({ token: ADMIN_SECRET }), // Wrong: token in body
      nextUrl: {
        searchParams: {
          /**
           * Returns null for all query parameters.
           * @returns Always null.
           */
          get: () => null, // No query param
        },
      },
    } as any;

    const res = await DELETE(req, { params: Promise.resolve({ id: "review-123" }) });

    expect(res.status).toBe(401);
    expect(prisma.review.delete).not.toHaveBeenCalled();
  });

  it("handles URL-encoded token in query param", async () => {
    const encodedToken = encodeURIComponent(ADMIN_SECRET);
    const req = makeDeleteRequest(encodedToken);

    const res = await DELETE(req, { params: Promise.resolve({ id: "review-123" }) });

    // Should succeed if ADMIN_SECRET doesn't have special chars needing encoding
    // (or fail if encoding changes the token value)
    if (encodedToken === ADMIN_SECRET) {
      expect(res.status).toBe(200);
    } else {
      expect(res.status).toBe(401);
    }
  });
});
