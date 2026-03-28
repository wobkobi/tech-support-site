import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isAdminRequest: vi.fn(),
  contactUpdate: vi.fn(),
  contactFindFirst: vi.fn(),
  syncContactToGoogle: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isAdminRequest: mocks.isAdminRequest,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    contact: {
      update: mocks.contactUpdate,
      findFirst: mocks.contactFindFirst,
    },
  },
}));

vi.mock("@/features/contacts/lib/google-contacts", () => ({
  syncContactToGoogle: mocks.syncContactToGoogle,
}));

import { PATCH } from "../../src/app/api/admin/contacts/[id]/route";

const CONTACT = {
  id: "contact-123",
  name: "Alice Smith",
  email: "alice@example.com",
  phone: "021 111 2222",
  address: "1 Main St, Auckland",
};

const PARAMS = { params: Promise.resolve({ id: "contact-123" }) };

/**
 * Creates a fake NextRequest with the given JSON body.
 * @param body - The request body object.
 * @returns A minimal fake NextRequest.
 */
function makeRequest(body: object): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe("PATCH /api/admin/contacts/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.contactUpdate.mockResolvedValue(CONTACT);
    mocks.contactFindFirst.mockResolvedValue(null);
    mocks.syncContactToGoogle.mockResolvedValue(undefined);
  });

  it("returns 401 when not admin", async () => {
    mocks.isAdminRequest.mockReturnValue(false);
    const res = await PATCH(makeRequest({}), PARAMS);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("updates the contact in the DB and returns it", async () => {
    const res = await PATCH(
      makeRequest({ name: "Alice Updated", phone: "021 999 8888", address: "2 New St" }),
      PARAMS,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.contact).toEqual(CONTACT);
    expect(mocks.contactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contact-123" },
      }),
    );
  });

  it("calls syncContactToGoogle after updating the contact", async () => {
    await PATCH(makeRequest({ name: "Alice" }), PARAMS);
    expect(mocks.syncContactToGoogle).toHaveBeenCalledWith("contact-123");
  });

  it("still returns ok:true when syncContactToGoogle throws (best-effort)", async () => {
    mocks.syncContactToGoogle.mockRejectedValue(new Error("Google API error"));
    const res = await PATCH(makeRequest({ name: "Alice" }), PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("strips whitespace from name", async () => {
    await PATCH(makeRequest({ name: "  Bob  " }), PARAMS);
    expect(mocks.contactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Bob" }),
      }),
    );
  });

  it("sets phone to null when empty string is provided", async () => {
    await PATCH(makeRequest({ phone: "   " }), PARAMS);
    expect(mocks.contactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phone: null }),
      }),
    );
  });

  it("returns 400 when name is an empty string", async () => {
    const res = await PATCH(makeRequest({ name: "" }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name is required/i);
  });

  it("returns 400 when phone is not a valid phone number", async () => {
    const res = await PATCH(makeRequest({ phone: "123" }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/valid phone/i);
  });

  it("updates email when a valid email is provided", async () => {
    const res = await PATCH(makeRequest({ email: "newalice@example.com" }), PARAMS);
    expect(res.status).toBe(200);
    expect(mocks.contactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "newalice@example.com" }),
      }),
    );
  });

  it("normalises email to lowercase", async () => {
    await PATCH(makeRequest({ email: "Alice@Example.COM" }), PARAMS);
    expect(mocks.contactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "alice@example.com" }),
      }),
    );
  });

  it("returns 400 when email is an empty string", async () => {
    const res = await PATCH(makeRequest({ email: "" }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/email is required/i);
  });

  it("returns 400 when email format is invalid", async () => {
    const res = await PATCH(makeRequest({ email: "not-an-email" }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/valid email/i);
  });

  it("returns 409 when email is already used by another contact", async () => {
    mocks.contactFindFirst.mockResolvedValue({ id: "other-contact" });
    const res = await PATCH(makeRequest({ email: "taken@example.com" }), PARAMS);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already in use/i);
  });
});
