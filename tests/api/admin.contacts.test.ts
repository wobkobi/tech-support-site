import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isAdminRequest: vi.fn(),
  contactFindMany: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isAdminRequest: mocks.isAdminRequest,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    contact: {
      findMany: mocks.contactFindMany,
    },
  },
}));

import { GET } from "../../src/app/api/admin/contacts/route";

const FAKE_REQ = {} as unknown as NextRequest;

const CONTACTS = [
  {
    id: "c1",
    name: "Alice",
    email: "alice@example.com",
    phone: "021 111 2222",
    address: "1 Main St",
    createdAt: new Date("2026-03-01T00:00:00Z"),
  },
  {
    id: "c2",
    name: "Bob",
    email: "bob@example.com",
    phone: null,
    address: null,
    createdAt: new Date("2026-02-01T00:00:00Z"),
  },
];

describe("GET /api/admin/contacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.contactFindMany.mockResolvedValue(CONTACTS);
  });

  it("returns 401 when not admin", async () => {
    mocks.isAdminRequest.mockReturnValue(false);
    const res = await GET(FAKE_REQ);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns contacts list on success", async () => {
    const res = await GET(FAKE_REQ);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.contacts).toHaveLength(2);
    expect(json.contacts[0].email).toBe("alice@example.com");
  });

  it("returns 500 on DB error", async () => {
    mocks.contactFindMany.mockRejectedValue(new Error("DB failure"));
    await expect(GET(FAKE_REQ)).rejects.toThrow("DB failure");
  });
});
