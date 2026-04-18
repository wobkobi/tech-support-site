import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isValidAdminToken: vi.fn(),
  buildPastClientReviewEmailHtml: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isValidAdminToken: mocks.isValidAdminToken,
}));

vi.mock("@/features/reviews/lib/email", () => ({
  buildPastClientReviewEmailHtml: mocks.buildPastClientReviewEmailHtml,
}));

import { POST } from "../../src/app/api/admin/preview-review-email/route";

/**
 * Builds a minimal fake NextRequest that returns the given object as its JSON body.
 * @param body - The JSON body to return from request.json().
 * @returns Fake NextRequest.
 */
function makeRequest(body: object): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe("POST /api/admin/preview-review-email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isValidAdminToken.mockReturnValue(true);
    mocks.buildPastClientReviewEmailHtml.mockReturnValue("<html>preview</html>");
  });

  it("returns 401 when token is invalid", async () => {
    mocks.isValidAdminToken.mockReturnValue(false);
    const res = await POST(makeRequest({ token: "bad", name: "Alice" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/unauthorized/i);
  });

  it("returns 400 when name is absent", async () => {
    const res = await POST(makeRequest({ token: "secret" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/name is required/i);
  });

  it("returns 400 when name is only whitespace", async () => {
    const res = await POST(makeRequest({ token: "secret", name: "   " }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("returns 200 with rendered html on success", async () => {
    const res = await POST(makeRequest({ token: "secret", name: "Alice Smith" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.html).toBe("<html>preview</html>");
  });

  it("passes only the first name to the email builder", async () => {
    await POST(makeRequest({ token: "secret", name: "Alice Smith" }));
    expect(mocks.buildPastClientReviewEmailHtml).toHaveBeenCalledWith("Alice", "#preview");
  });

  it("uses the full value when name is a single word", async () => {
    await POST(makeRequest({ token: "secret", name: "Bob" }));
    expect(mocks.buildPastClientReviewEmailHtml).toHaveBeenCalledWith("Bob", "#preview");
  });

  it("returns 500 when json parsing throws", async () => {
    const badReq = {
      json: async () => {
        throw new Error("parse error");
      },
    } as unknown as NextRequest;
    const res = await POST(badReq);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/failed to generate preview/i);
  });
});
