// src/features/contacts/lib/contact-360.ts
// Loads everything a contact touches, matching exactly as maintenance.ts does: email first,
// then mobile-only phone keys (a shared landline may be a household).

import { isNZMobileKey, normaliseContactPhone } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import type { Contact } from "@prisma/client";

/** A booking that matched this contact by email or mobile. */
interface Contact360Booking {
  id: string;
  name: string;
  startAt: Date;
  status: string;
  address: string | null;
}

/** An invoice linked to this contact by contactId or client email. */
interface Contact360Invoice {
  id: string;
  number: string;
  total: number;
  status: string;
  issueDate: Date;
}

/** An income entry reached through one of the contact's invoices. */
interface Contact360Income {
  id: string;
  amount: number;
  date: Date;
  method: string;
  invoiceId: string | null;
}

/** A review linked to this contact by contactId. */
interface Contact360Review {
  id: string;
  text: string;
  status: string;
  createdAt: Date;
}

/** Everything a contact touches, with rollup totals for the summary cards. */
export interface Contact360 {
  contact: Contact;
  bookings: Contact360Booking[];
  invoices: Contact360Invoice[];
  income: Contact360Income[];
  reviews: Contact360Review[];
  totals: {
    bookings: number;
    invoices: number;
    /** Sum of every linked income entry's amount, in NZD. */
    incomeTotal: number;
    reviews: number;
  };
}

// Cap on the phone-only fallback's JS-filtered scan (booking phones are un-normalised);
// denormalise the link if volume outgrows it.
const PHONE_FALLBACK_SCAN_CAP = 1000;

/**
 * Loads every record linked to a contact for the customer-360 page; null when the
 * contact is missing or soft-deleted.
 * @param contactId - The contact's id.
 * @returns The contact plus its linked bookings, invoices, income, and reviews, or null.
 */
export async function loadContact360(contactId: string): Promise<Contact360 | null> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, deletedAt: null },
  });
  if (!contact) return null;

  // Match keys as maintenance.ts builds them: lowercased emails, mobile-only phone keys.
  const emailKeys = new Set<string>();
  if (contact.email) emailKeys.add(contact.email.toLowerCase());
  for (const alt of contact.altEmails) emailKeys.add(alt.toLowerCase());

  const mobileKeys = new Set<string>();
  for (const raw of [contact.phone, ...contact.altPhones]) {
    const key = normaliseContactPhone(raw);
    if (key && isNZMobileKey(key)) mobileKeys.add(key);
  }

  const [bookings, invoices, reviews] = await Promise.all([
    loadBookings(emailKeys, mobileKeys),
    loadInvoices(contact.id, emailKeys),
    prisma.review.findMany({
      where: { contactId: contact.id },
      select: { id: true, text: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Income has no contact link - reach it through the contact's invoices.
  const invoiceIds = invoices.map((i) => i.id);
  const income =
    invoiceIds.length > 0
      ? await prisma.incomeEntry.findMany({
          where: { invoiceId: { in: invoiceIds } },
          select: { id: true, amount: true, date: true, method: true, invoiceId: true },
          orderBy: { date: "desc" },
        })
      : [];

  return {
    contact,
    bookings,
    invoices,
    income,
    reviews,
    totals: {
      bookings: bookings.length,
      invoices: invoices.length,
      incomeTotal: income.reduce((sum, e) => sum + e.amount, 0),
      reviews: reviews.length,
    },
  };
}

/**
 * Bookings matched to a contact by email, with a bounded phone fallback only
 * when the contact has no email.
 * @param emailKeys - Lowercased email + altEmails.
 * @param mobileKeys - Normalised mobile keys from phone + altPhones.
 * @returns Matched bookings, most recent first.
 */
async function loadBookings(
  emailKeys: Set<string>,
  mobileKeys: Set<string>,
): Promise<Contact360Booking[]> {
  const select = {
    id: true,
    name: true,
    startAt: true,
    status: true,
    address: true,
  } as const;

  // Email match: Booking.email is stored un-lowercased, so compare case-insensitively.
  if (emailKeys.size > 0) {
    return prisma.booking.findMany({
      where: {
        OR: [...emailKeys].map((e) => ({ email: { equals: e, mode: "insensitive" as const } })),
      },
      select,
      orderBy: { startAt: "desc" },
    });
  }

  // Phone fallback (email-less contact only): bounded scan filtered in JS.
  if (mobileKeys.size > 0) {
    const recent = await prisma.booking.findMany({
      where: { phone: { not: null } },
      select: { ...select, phone: true },
      orderBy: { startAt: "desc" },
      take: PHONE_FALLBACK_SCAN_CAP,
    });
    return recent
      .filter((b) => {
        const key = normaliseContactPhone(b.phone);
        return key !== null && mobileKeys.has(key);
      })
      .map((b) => ({
        id: b.id,
        name: b.name,
        startAt: b.startAt,
        status: b.status,
        address: b.address,
      }));
  }

  return [];
}

/**
 * Invoices linked by contactId, plus unlinked rows with a matching client email.
 * @param contactId - The contact's id.
 * @param emailKeys - Lowercased email + altEmails.
 * @returns Matched invoices, most recent first.
 */
async function loadInvoices(
  contactId: string,
  emailKeys: Set<string>,
): Promise<Contact360Invoice[]> {
  const emailMatch = [...emailKeys].map((e) => ({
    clientEmail: { equals: e, mode: "insensitive" as const },
  }));
  return prisma.invoice.findMany({
    where: { OR: [{ contactId }, ...emailMatch] },
    select: { id: true, number: true, total: true, status: true, issueDate: true },
    orderBy: { issueDate: "desc" },
  });
}
