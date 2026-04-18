import { describe, it, expect, vi } from "vitest";
import { autoMaintain } from "@/features/admin/lib/auto-maintain";
import type { PrismaClient } from "@prisma/client";

// autoMaintain(prisma) calls three internal phases sequentially:
//   1. backfillContacts  - creates Contact records from Bookings/ReviewRequests
//   2. matchReviewContacts - links unlinked Reviews to Contacts
//   3. autoEnrich - fills missing fields and returns conflict entries

/**
 * Creates a minimal Prisma mock pre-seeded with test data for all three autoMaintain phases.
 * @param root0 - Seed data options.
 * @param root0.bookings - Booking records to return from findMany.
 * @param root0.reviewRequests - ReviewRequest records to return from findMany.
 * @param root0.contacts - Contact records to return from findMany.
 * @param root0.reviews - Review records to return from findMany.
 * @returns Typed Prisma mock.
 */
function makePrisma({
  bookings = [] as unknown[],
  reviewRequests = [] as unknown[],
  contacts = [] as unknown[],
  reviews = [] as unknown[],
} = {}) {
  return {
    booking: { findMany: vi.fn().mockResolvedValue(bookings) },
    reviewRequest: { findMany: vi.fn().mockResolvedValue(reviewRequests) },
    contact: {
      findMany: vi.fn().mockResolvedValue(contacts),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    review: {
      findMany: vi.fn().mockResolvedValue(reviews),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

/**
 * Returns the vi.fn() mock for a given model method on a Prisma mock instance.
 * @param prisma - The Prisma mock created by makePrisma.
 * @param model - The Prisma model name (e.g. "contact").
 * @param method - The method name (e.g. "create").
 * @returns The Vitest mock function.
 */
function m(prisma: PrismaClient, model: string, method: string) {
  return (prisma as any)[model][method] as ReturnType<typeof vi.fn>;
}

describe("autoMaintain", () => {
  // ─── backfillContacts ───────────────────────────────────────────────────────

  it("returns empty conflicts when the database is empty", async () => {
    const prisma = makePrisma();
    const conflicts = await autoMaintain(prisma);
    expect(conflicts).toEqual([]);
    expect(m(prisma, "contact", "create")).not.toHaveBeenCalled();
  });

  it("creates a contact from a new booking email", async () => {
    const prisma = makePrisma({
      bookings: [{ name: "Alice Smith", email: "alice@example.com", phone: null, notes: null }],
    });
    await autoMaintain(prisma);
    expect(m(prisma, "contact", "create")).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Alice Smith", email: "alice@example.com" }),
      }),
    );
  });

  it("extracts address from booking notes when creating a contact", async () => {
    const prisma = makePrisma({
      bookings: [
        {
          name: "Bob",
          email: "bob@example.com",
          phone: null,
          notes: "Fix printer\nAddress: 12 High St",
        },
      ],
    });
    await autoMaintain(prisma);
    expect(m(prisma, "contact", "create")).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ address: "12 High St" }),
      }),
    );
  });

  it("skips creating a contact when the email already exists", async () => {
    const prisma = makePrisma({
      bookings: [{ name: "Alice", email: "alice@example.com", phone: null, notes: null }],
      contacts: [{ id: "c1", name: "Alice", email: "alice@example.com", phone: null }],
    });
    await autoMaintain(prisma);
    expect(m(prisma, "contact", "create")).not.toHaveBeenCalled();
  });

  it("creates a contact from a review request email", async () => {
    const prisma = makePrisma({
      reviewRequests: [{ name: "Carol", email: "carol@example.com", phone: null }],
    });
    await autoMaintain(prisma);
    expect(m(prisma, "contact", "create")).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "carol@example.com" }),
      }),
    );
  });

  it("creates a phone-only contact from a review request with no email", async () => {
    const prisma = makePrisma({
      reviewRequests: [{ name: "Dan", email: null, phone: "021 111 2222" }],
    });
    await autoMaintain(prisma);
    expect(m(prisma, "contact", "create")).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: null, phone: "+64211112222" }),
      }),
    );
  });

  it("merges a phone-only contact into the email-based contact sharing the same phone", async () => {
    const prisma = makePrisma({
      contacts: [
        { id: "c-email", name: "Eve", email: "eve@example.com", phone: "+64211112222" },
        { id: "c-phone", name: "Eve", email: null, phone: "+64211112222" },
      ],
    });
    await autoMaintain(prisma);
    expect(m(prisma, "review", "updateMany")).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contactId: "c-phone" },
        data: { contactId: "c-email" },
      }),
    );
    expect(m(prisma, "contact", "delete")).toHaveBeenCalledWith({ where: { id: "c-phone" } });
  });

  it("merges booking email into an existing phone-only contact with the same phone", async () => {
    const prisma = makePrisma({
      bookings: [
        { name: "Alice Smith", email: "alice@example.com", phone: "021 111 2222", notes: null },
      ],
      contacts: [{ id: "c-phone", name: "Alice", email: null, phone: "+64211112222" }],
    });
    await autoMaintain(prisma);
    // Should update the phone-only contact with the email instead of creating a new one
    expect(m(prisma, "contact", "update")).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c-phone" },
        data: expect.objectContaining({ email: "alice@example.com" }),
      }),
    );
    expect(m(prisma, "contact", "create")).not.toHaveBeenCalled();
  });

  // ─── matchReviewContacts ────────────────────────────────────────────────────

  it("links an unlinked review to a contact by booking email", async () => {
    const prisma = makePrisma({
      bookings: [{ id: "b1", name: "Alice", email: "alice@example.com", phone: null, notes: null }],
      contacts: [
        { id: "c1", name: "Alice", email: "alice@example.com", phone: null, address: null },
      ],
      reviews: [{ id: "r1", bookingId: "b1", customerRef: null }],
    });
    await autoMaintain(prisma);
    expect(m(prisma, "review", "update")).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { contactId: "c1" },
    });
  });

  it("links an unlinked review to a contact by booking phone when email has no match", async () => {
    const prisma = makePrisma({
      bookings: [
        { id: "b1", name: "Frank", email: "frank@example.com", phone: "021 111 2222", notes: null },
      ],
      contacts: [{ id: "c1", name: "Frank", email: null, phone: "+64211112222", address: null }],
      reviews: [{ id: "r1", bookingId: "b1", customerRef: null }],
    });
    await autoMaintain(prisma);
    expect(m(prisma, "review", "update")).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { contactId: "c1" },
    });
  });

  it("links an unlinked review to a contact by review request token and email", async () => {
    const prisma = makePrisma({
      reviewRequests: [
        { id: "rr1", reviewToken: "tok1", name: "Grace", email: "grace@example.com", phone: null },
      ],
      contacts: [
        { id: "c1", name: "Grace", email: "grace@example.com", phone: null, address: null },
      ],
      reviews: [{ id: "r1", bookingId: null, customerRef: "tok1" }],
    });
    await autoMaintain(prisma);
    expect(m(prisma, "review", "update")).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { contactId: "c1" },
    });
  });

  it("does not update a review when no matching contact is found", async () => {
    const prisma = makePrisma({
      reviews: [{ id: "r1", bookingId: null, customerRef: "unknown-token" }],
    });
    await autoMaintain(prisma);
    expect(m(prisma, "review", "update")).not.toHaveBeenCalled();
  });

  // ─── autoEnrich ─────────────────────────────────────────────────────────────

  it("fills a missing phone on a contact from a review request", async () => {
    const prisma = makePrisma({
      reviewRequests: [
        { id: "rr1", name: "Heidi", email: "heidi@example.com", phone: "021 111 2222" },
      ],
      contacts: [
        { id: "c1", name: "Heidi", email: "heidi@example.com", phone: null, address: null },
      ],
    });
    await autoMaintain(prisma);
    expect(m(prisma, "contact", "update")).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" }, data: { phone: "+64211112222" } }),
    );
  });

  it("fills a missing phone on a contact from a booking", async () => {
    const prisma = makePrisma({
      bookings: [
        { id: "b1", name: "Ivan", email: "ivan@example.com", phone: "021 333 4444", notes: null },
      ],
      contacts: [{ id: "c1", name: "Ivan", email: "ivan@example.com", phone: null, address: null }],
    });
    await autoMaintain(prisma);
    expect(m(prisma, "contact", "update")).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" }, data: { phone: "+64213334444" } }),
    );
  });

  it("fills a missing address on a contact from a booking", async () => {
    const prisma = makePrisma({
      bookings: [
        {
          id: "b1",
          name: "Jane",
          email: "jane@example.com",
          phone: null,
          notes: "Address: 5 Oak Ave",
        },
      ],
      contacts: [{ id: "c1", name: "Jane", email: "jane@example.com", phone: null, address: null }],
    });
    await autoMaintain(prisma);
    expect(m(prisma, "contact", "update")).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" }, data: { address: "5 Oak Ave" } }),
    );
  });

  it("auto-fills name when source provides a full name and contact has only a first name", async () => {
    const prisma = makePrisma({
      reviewRequests: [{ id: "rr1", name: "Alice Smith", email: "alice@example.com", phone: null }],
      contacts: [
        { id: "c1", name: "Alice", email: "alice@example.com", phone: null, address: null },
      ],
    });
    await autoMaintain(prisma);
    expect(m(prisma, "contact", "update")).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" }, data: { name: "Alice Smith" } }),
    );
  });

  it("reports a name conflict when review request name differs from contact name", async () => {
    const prisma = makePrisma({
      reviewRequests: [{ id: "rr1", name: "Alice Jones", email: "alice@example.com", phone: null }],
      contacts: [
        { id: "c1", name: "Alice Smith", email: "alice@example.com", phone: null, address: null },
      ],
    });
    const conflicts = await autoMaintain(prisma);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      contactId: "c1",
      source: "ReviewRequest",
      conflictFields: expect.arrayContaining(["name"]),
    });
  });

  it("reports a phone conflict when booking phone differs from contact phone", async () => {
    const prisma = makePrisma({
      bookings: [
        { id: "b1", name: "Bob", email: "bob@example.com", phone: "021 333 4444", notes: null },
      ],
      contacts: [
        { id: "c1", name: "Bob", email: "bob@example.com", phone: "+64211112222", address: null },
      ],
    });
    const conflicts = await autoMaintain(prisma);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      contactId: "c1",
      source: "Booking",
      conflictFields: expect.arrayContaining(["phone"]),
    });
  });

  it("does not report a conflict when proposed name is a prefix of the contact full name", async () => {
    // "Alice" proposed vs "Alice Smith" on contact → no conflict (contact is the longer name)
    const prisma = makePrisma({
      reviewRequests: [{ id: "rr1", name: "Alice", email: "alice@example.com", phone: null }],
      contacts: [
        { id: "c1", name: "Alice Smith", email: "alice@example.com", phone: null, address: null },
      ],
    });
    const conflicts = await autoMaintain(prisma);
    expect(conflicts).toHaveLength(0);
  });

  it("does not report a conflict when names match exactly", async () => {
    const prisma = makePrisma({
      bookings: [{ id: "b1", name: "Bob", email: "bob@example.com", phone: null, notes: null }],
      contacts: [{ id: "c1", name: "Bob", email: "bob@example.com", phone: null, address: null }],
    });
    const conflicts = await autoMaintain(prisma);
    expect(conflicts).toHaveLength(0);
  });
});
