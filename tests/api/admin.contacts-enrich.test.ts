import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isAdminRequest: vi.fn(),
  contactFindMany: vi.fn(),
  reviewRequestFindMany: vi.fn(),
  reviewFindMany: vi.fn(),
  contactUpdate: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  isAdminRequest: mocks.isAdminRequest,
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    contact: {
      findMany: mocks.contactFindMany,
      update: mocks.contactUpdate,
    },
    reviewRequest: {
      findMany: mocks.reviewRequestFindMany,
    },
    review: {
      findMany: mocks.reviewFindMany,
    },
  },
}));

import { POST } from "../../src/app/api/admin/contacts/enrich-from-reviews/route";

const CONTACT = {
  id: "contact-1",
  name: "Alice Smith",
  email: "alice@example.com",
  phone: "021 111 1111",
};

const CONTACT_NO_PHONE = {
  id: "contact-2",
  name: "Bob Jones",
  email: "bob@example.com",
  phone: null,
};

/**
 * Creates a minimal fake NextRequest (no body needed for this POST).
 * @returns A minimal fake NextRequest.
 */
function makeRequest(): NextRequest {
  return {} as unknown as NextRequest;
}

describe("POST /api/admin/contacts/enrich-from-reviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminRequest.mockReturnValue(true);
    mocks.contactFindMany.mockResolvedValue([]);
    mocks.reviewRequestFindMany.mockResolvedValue([]);
    mocks.reviewFindMany.mockResolvedValue([]);
    mocks.contactUpdate.mockResolvedValue({});
  });

  it("returns 401 when not admin", async () => {
    mocks.isAdminRequest.mockReturnValue(false);
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 0 enriched and no conflicts when there are no contacts", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.enrichedCount).toBe(0);
    expect(json.conflicts).toEqual([]);
  });

  it("returns 0 enriched and no conflicts when no review data matches a contact email", async () => {
    mocks.contactFindMany.mockResolvedValue([CONTACT]);
    mocks.reviewRequestFindMany.mockResolvedValue([
      { id: "rr-1", name: "Other Person", email: "other@example.com", phone: null },
    ]);
    mocks.reviewFindMany.mockResolvedValue([]);
    const res = await POST(makeRequest());
    const json = await res.json();
    expect(json.enrichedCount).toBe(0);
    expect(json.conflicts).toEqual([]);
  });

  it("returns a name conflict when ReviewRequest name differs from contact name", async () => {
    mocks.contactFindMany.mockResolvedValue([CONTACT]);
    mocks.reviewRequestFindMany.mockResolvedValue([
      { id: "rr-1", name: "A. Smith", email: "alice@example.com", phone: null },
    ]);
    mocks.reviewFindMany.mockResolvedValue([]);
    const res = await POST(makeRequest());
    const json = await res.json();
    expect(json.conflicts).toHaveLength(1);
    expect(json.conflicts[0]).toMatchObject({
      contactId: "contact-1",
      source: "ReviewRequest",
      sourceId: "rr-1",
      sourceName: "A. Smith",
      conflictFields: ["name"],
    });
  });

  it("returns a phone conflict when ReviewRequest phone differs from contact phone", async () => {
    mocks.contactFindMany.mockResolvedValue([CONTACT]);
    mocks.reviewRequestFindMany.mockResolvedValue([
      { id: "rr-1", name: "Alice Smith", email: "alice@example.com", phone: "021 222 2222" },
    ]);
    mocks.reviewFindMany.mockResolvedValue([]);
    const res = await POST(makeRequest());
    const json = await res.json();
    expect(json.conflicts).toHaveLength(1);
    expect(json.conflicts[0]).toMatchObject({
      contactId: "contact-1",
      source: "ReviewRequest",
      sourceId: "rr-1",
      sourcePhone: "021 222 2222",
      conflictFields: ["phone"],
    });
  });

  it("auto-enriches contact phone when contact has no phone and ReviewRequest has one", async () => {
    mocks.contactFindMany.mockResolvedValue([CONTACT_NO_PHONE]);
    mocks.reviewRequestFindMany.mockResolvedValue([
      { id: "rr-2", name: "Bob Jones", email: "bob@example.com", phone: "021 999 9999" },
    ]);
    mocks.reviewFindMany.mockResolvedValue([]);
    const res = await POST(makeRequest());
    const json = await res.json();
    expect(json.enrichedCount).toBe(1);
    expect(json.conflicts).toEqual([]);
    expect(mocks.contactUpdate).toHaveBeenCalledWith({
      where: { id: "contact-2" },
      data: { phone: "021 999 9999" },
    });
  });

  it("does not enrich or conflict when name and phone match exactly", async () => {
    mocks.contactFindMany.mockResolvedValue([CONTACT]);
    mocks.reviewRequestFindMany.mockResolvedValue([
      { id: "rr-1", name: "Alice Smith", email: "alice@example.com", phone: "021 111 1111" },
    ]);
    mocks.reviewFindMany.mockResolvedValue([]);
    const res = await POST(makeRequest());
    const json = await res.json();
    expect(json.enrichedCount).toBe(0);
    expect(json.conflicts).toEqual([]);
  });

  it("does not conflict when names differ only by case", async () => {
    mocks.contactFindMany.mockResolvedValue([CONTACT]);
    mocks.reviewRequestFindMany.mockResolvedValue([
      { id: "rr-1", name: "alice smith", email: "alice@example.com", phone: null },
    ]);
    mocks.reviewFindMany.mockResolvedValue([]);
    const res = await POST(makeRequest());
    const json = await res.json();
    expect(json.conflicts).toEqual([]);
  });

  it("uses only the most recent ReviewRequest per contact (first in desc order)", async () => {
    mocks.contactFindMany.mockResolvedValue([CONTACT]);
    mocks.reviewRequestFindMany.mockResolvedValue([
      // Most recent first — this one should win
      { id: "rr-new", name: "Alice S.", email: "alice@example.com", phone: null },
      { id: "rr-old", name: "A. Smith", email: "alice@example.com", phone: null },
    ]);
    mocks.reviewFindMany.mockResolvedValue([]);
    const res = await POST(makeRequest());
    const json = await res.json();
    expect(json.conflicts).toHaveLength(1);
    expect(json.conflicts[0].sourceId).toBe("rr-new");
  });

  it("returns a name conflict from a Review when firstName+lastName differs from contact name", async () => {
    mocks.contactFindMany.mockResolvedValue([CONTACT]);
    mocks.reviewRequestFindMany.mockResolvedValue([]);
    mocks.reviewFindMany.mockResolvedValue([
      { id: "rev-1", firstName: "Alice", lastName: "S.", customerRef: "alice@example.com" },
    ]);
    const res = await POST(makeRequest());
    const json = await res.json();
    expect(json.conflicts).toHaveLength(1);
    expect(json.conflicts[0]).toMatchObject({
      source: "Review",
      sourceId: "rev-1",
      sourceName: "Alice S.",
      conflictFields: ["name"],
    });
  });

  it("does not conflict when Review name matches contact name", async () => {
    mocks.contactFindMany.mockResolvedValue([CONTACT]);
    mocks.reviewRequestFindMany.mockResolvedValue([]);
    mocks.reviewFindMany.mockResolvedValue([
      { id: "rev-1", firstName: "Alice", lastName: "Smith", customerRef: "alice@example.com" },
    ]);
    const res = await POST(makeRequest());
    const json = await res.json();
    expect(json.conflicts).toEqual([]);
  });

  it("skips Review records with null customerRef", async () => {
    mocks.contactFindMany.mockResolvedValue([CONTACT]);
    mocks.reviewRequestFindMany.mockResolvedValue([]);
    mocks.reviewFindMany.mockResolvedValue([
      { id: "rev-1", firstName: "Bob", lastName: "Doe", customerRef: null },
    ]);
    const res = await POST(makeRequest());
    const json = await res.json();
    expect(json.conflicts).toEqual([]);
  });

  it("skips Review records with no name parts", async () => {
    mocks.contactFindMany.mockResolvedValue([CONTACT]);
    mocks.reviewRequestFindMany.mockResolvedValue([]);
    mocks.reviewFindMany.mockResolvedValue([
      { id: "rev-1", firstName: null, lastName: null, customerRef: "alice@example.com" },
    ]);
    const res = await POST(makeRequest());
    const json = await res.json();
    expect(json.conflicts).toEqual([]);
  });

  it("matches contact email case-insensitively", async () => {
    mocks.contactFindMany.mockResolvedValue([CONTACT]);
    mocks.reviewRequestFindMany.mockResolvedValue([
      { id: "rr-1", name: "Different Name", email: "ALICE@EXAMPLE.COM", phone: null },
    ]);
    mocks.reviewFindMany.mockResolvedValue([]);
    const res = await POST(makeRequest());
    const json = await res.json();
    expect(json.conflicts).toHaveLength(1);
  });
});
