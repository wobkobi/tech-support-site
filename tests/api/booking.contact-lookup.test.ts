import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  contactFindFirst: vi.fn(),
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    contact: {
      findFirst: mocks.contactFindFirst,
    },
  },
}));

import { GET } from "../../src/app/api/booking/contact-lookup/route";

/**
 * Build a NextRequest for the contact-lookup endpoint.
 * @param email - Optional email query parameter.
 * @returns NextRequest instance.
 */
function makeReq(email?: string): NextRequest {
  const url = email
    ? `http://localhost/api/booking/contact-lookup?email=${encodeURIComponent(email)}`
    : "http://localhost/api/booking/contact-lookup";
  return new NextRequest(url);
}

describe("GET /api/booking/contact-lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when email param is missing", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("returns 400 when email is not valid", async () => {
    const res = await GET(makeReq("notanemail"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when contact is not found", async () => {
    mocks.contactFindFirst.mockResolvedValue(null);
    const res = await GET(makeReq("unknown@example.com"));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("returns contact fields when found", async () => {
    mocks.contactFindFirst.mockResolvedValue({
      name: "Alice",
      phone: "021 111 2222",
      address: "1 Main St",
    });
    const res = await GET(makeReq("alice@example.com"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.name).toBe("Alice");
    expect(json.phone).toBe("021 111 2222");
    expect(json.address).toBe("1 Main St");
  });

  it("normalises email to lowercase before lookup", async () => {
    mocks.contactFindFirst.mockResolvedValue(null);
    await GET(makeReq("ALICE@Example.COM"));
    expect(mocks.contactFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "alice@example.com" } }),
    );
  });
});
