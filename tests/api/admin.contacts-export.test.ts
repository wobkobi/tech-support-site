import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isValidAdminToken: vi.fn(),
  contactFindMany: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isValidAdminToken: mocks.isValidAdminToken,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    contact: { findMany: mocks.contactFindMany },
  },
}));

import { GET } from "../../src/app/api/admin/contacts/export/route";

/**
 * Builds a minimal fake NextRequest with the given token query param.
 * @param token - Value for the "token" query parameter, or null to omit it.
 * @returns Fake NextRequest.
 */
function makeRequest(token: string | null): NextRequest {
  return {
    nextUrl: { searchParams: { get: (k: string) => (k === "token" ? token : null) } },
  } as unknown as NextRequest;
}

describe("GET /api/admin/contacts/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isValidAdminToken.mockReturnValue(true);
    mocks.contactFindMany.mockResolvedValue([]);
  });

  it("returns 401 when token is invalid", async () => {
    mocks.isValidAdminToken.mockReturnValue(false);
    const res = await GET(makeRequest("bad-token"));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 200 with correct Content-Type and Content-Disposition", async () => {
    const res = await GET(makeRequest("secret"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("contacts.csv");
  });

  it("includes UTF-8 BOM as the first three bytes of the response", async () => {
    const res = await GET(makeRequest("secret"));
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // UTF-8 BOM: EF BB BF
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
  });

  it("includes Google Contacts header columns", async () => {
    const res = await GET(makeRequest("secret"));
    const text = await res.text();
    const headerLine = text.split("\r\n")[0];
    expect(headerLine).toContain("First Name");
    expect(headerLine).toContain("Last Name");
    expect(headerLine).toContain("E-mail 1 - Value");
    expect(headerLine).toContain("Phone 1 - Value");
    expect(headerLine).toContain("Address 1 - Formatted");
  });

  it("splits a full name into first and last name columns", async () => {
    mocks.contactFindMany.mockResolvedValue([
      { name: "Alice Smith", email: "alice@example.com", phone: null, address: null },
    ]);
    const res = await GET(makeRequest("secret"));
    const text = await res.text();
    const dataLine = text.split("\r\n")[1];
    expect(dataLine).toContain('"Alice"');
    expect(dataLine).toContain('"Smith"');
  });

  it("treats a single-word name as first name with empty last name", async () => {
    mocks.contactFindMany.mockResolvedValue([
      { name: "Alice", email: null, phone: null, address: null },
    ]);
    const res = await GET(makeRequest("secret"));
    const text = await res.text();
    const dataLine = text.split("\r\n")[1];
    expect(dataLine).toMatch(/"Alice",""/);
  });

  it("handles multi-word first name correctly", async () => {
    mocks.contactFindMany.mockResolvedValue([
      { name: "Mary Jane Watson", email: null, phone: null, address: null },
    ]);
    const res = await GET(makeRequest("secret"));
    const text = await res.text();
    const dataLine = text.split("\r\n")[1];
    expect(dataLine).toContain('"Mary Jane"');
    expect(dataLine).toContain('"Watson"');
  });

  it("includes email and phone in the correct CSV columns", async () => {
    mocks.contactFindMany.mockResolvedValue([
      { name: "Bob", email: "bob@example.com", phone: "+64211112222", address: null },
    ]);
    const res = await GET(makeRequest("secret"));
    const text = await res.text();
    const dataLine = text.split("\r\n")[1];
    expect(dataLine).toContain('"bob@example.com"');
    expect(dataLine).toContain('"+64211112222"');
  });

  it("escapes double quotes inside CSV values", async () => {
    mocks.contactFindMany.mockResolvedValue([
      { name: 'O"Brien', email: null, phone: null, address: null },
    ]);
    const res = await GET(makeRequest("secret"));
    const text = await res.text();
    expect(text).toContain('"O""Brien"');
  });

  it("places contacts in the myContacts label group", async () => {
    mocks.contactFindMany.mockResolvedValue([
      { name: "Test User", email: "test@example.com", phone: null, address: null },
    ]);
    const res = await GET(makeRequest("secret"));
    const text = await res.text();
    expect(text).toContain('"* myContacts"');
  });

  it("sets primary email label when contact has an email", async () => {
    mocks.contactFindMany.mockResolvedValue([
      { name: "Eve", email: "eve@example.com", phone: null, address: null },
    ]);
    const res = await GET(makeRequest("secret"));
    const text = await res.text();
    expect(text).toContain('"* "');
  });

  it("leaves email label empty when contact has no email", async () => {
    mocks.contactFindMany.mockResolvedValue([
      { name: "No Email", email: null, phone: null, address: null },
    ]);
    const res = await GET(makeRequest("secret"));
    const text = await res.text();
    const dataLine = text.split("\r\n")[1];
    // email label column should be empty string
    expect(dataLine).toContain('""');
  });
});
