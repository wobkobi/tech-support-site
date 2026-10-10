// src/features/admin/lib/global-search.ts
// Server-side lookup behind the admin search dialog: matches one free-text query against
// contacts, bookings, invoices and reviews and returns a few ready-to-render hits per group.

import "server-only";

import { formatNZD } from "@/features/business/lib/business-format";
import { deriveInvoiceDisplayStatus } from "@/features/business/lib/invoice-status";
import { formatDateShort, formatDateTimeShort } from "@/shared/lib/date-format";
import { formatNZPhone, normaliseContactPhone } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { nzDateKey, nzTodayKey } from "@/shared/lib/timezone-utils";
import type { Prisma } from "@prisma/client";

/** Which record a hit points at. */
export type SearchHitType = "contact" | "booking" | "invoice" | "review";

/** One search result, already formatted for display. */
export interface SearchHit {
  /** Record kind. */
  type: SearchHitType;
  /** Record id. */
  id: string;
  /** Main line, e.g. the person's name or "INV-0042 - Jane Smith". */
  title: string;
  /** Secondary line: contact detail, date, status or total. */
  sub: string;
  /** Admin page the hit opens. */
  href: string;
}

/** Hits grouped by record kind, each group capped at {@link HITS_PER_GROUP}. */
export interface SearchGroups {
  contacts: SearchHit[];
  bookings: SearchHit[];
  invoices: SearchHit[];
  reviews: SearchHit[];
}

/** Shorter queries return nothing and run no database query. */
export const MIN_QUERY_LENGTH = 2;
/** Longer queries are cut to this many characters before searching. */
export const MAX_QUERY_LENGTH = 100;
/** Most hits returned per group. */
export const HITS_PER_GROUP = 5;

/**
 * A query made only of phone punctuation and digits. Letters rule it out, so an
 * invoice number such as "INV-0042" never runs the phone pass.
 */
const PHONE_LIKE = /^[\d\s+\-()]+$/;

/** A phone-shaped query in both of the forms stored numbers are compared against. */
interface PhoneQuery {
  /** The query's {@link normaliseContactPhone} key, or null when it has none. */
  key: string | null;
  /** The query's bare digits. */
  digits: string;
}

/**
 * Reads a query as a phone number when it looks like one: only digits, spaces,
 * "+", "-" and parentheses, with at least 3 digits.
 * @param q - Trimmed search query.
 * @returns The phone forms to match on, or null when the query is not phone-shaped.
 */
function toPhoneQuery(q: string): PhoneQuery | null {
  if (!PHONE_LIKE.test(q)) return null;
  const digits = q.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return { key: normaliseContactPhone(q), digits };
}

/**
 * Whether a stored phone matches a phone query. Prisma cannot normalise stored
 * values, so this runs in memory: the normalised keys catch "021 123" against a
 * stored "+64211234567", and the raw-digit check catches a fragment typed without
 * its prefix against a number stored as typed.
 * @param stored - Stored phone value (any format).
 * @param query - The phone query from {@link toPhoneQuery}.
 * @returns True when the stored number contains the query.
 */
function phoneMatches(stored: string | null | undefined, query: PhoneQuery): boolean {
  if (!stored) return false;
  const key = normaliseContactPhone(stored);
  if (key && query.key && key.includes(query.key)) return true;
  return stored.replace(/\D/g, "").includes(query.digits);
}

/**
 * Unions two result sets by id (first occurrence wins), sorts them and keeps the
 * top {@link HITS_PER_GROUP}.
 * @param a - Primary rows (text matches).
 * @param b - Extra rows (phone matches).
 * @param compare - Sort order for the merged list.
 * @returns The merged, sorted, capped rows.
 */
function mergeRows<T extends { id: string }>(a: T[], b: T[], compare: (x: T, y: T) => number): T[] {
  const byId = new Map<string, T>();
  for (const row of [...a, ...b]) if (!byId.has(row.id)) byId.set(row.id, row);
  return [...byId.values()].sort(compare).slice(0, HITS_PER_GROUP);
}

/**
 * Sentence-cases a stored enum value for display ("confirmed" > "Confirmed",
 * "OVERDUE" > "Overdue").
 * @param value - Raw status value.
 * @returns The display label.
 */
function statusLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/**
 * Contacts whose name, email, address or company contains the query, plus (for a
 * phone-shaped query) those whose primary or alternate phone contains it. Deleted
 * contacts never match.
 * @param q - Trimmed search query.
 * @param phone - Phone forms of the query, or null when it is not phone-shaped.
 * @returns Up to {@link HITS_PER_GROUP} contact hits, sorted by name.
 */
async function searchContacts(q: string, phone: PhoneQuery | null): Promise<SearchHit[]> {
  const contains = { contains: q, mode: "insensitive" as const };
  const select = { id: true, name: true, email: true, phone: true, address: true } as const;

  const [textRows, phoneRows] = await Promise.all([
    prisma.contact.findMany({
      where: {
        deletedAt: null,
        OR: [
          { name: contains },
          { email: contains },
          { address: contains },
          { company: contains },
          // Alternate emails are stored lowercased; a scalar list only supports exact match.
          { altEmails: { has: q.toLowerCase() } },
        ],
      },
      select,
      orderBy: { name: "asc" },
      take: HITS_PER_GROUP,
    }),
    phone
      ? prisma.contact.findMany({
          where: {
            deletedAt: null,
            OR: [{ phone: { isSet: true, not: null } }, { altPhones: { isEmpty: false } }],
          },
          select: { id: true, phone: true, altPhones: true },
        })
      : Promise.resolve([]),
  ]);

  // Phone pass: fetch display fields only for matches the text pass did not already return.
  const textIds = new Set(textRows.map((r) => r.id));
  const phoneIds = phone
    ? phoneRows
        .filter(
          (r) =>
            !textIds.has(r.id) &&
            (phoneMatches(r.phone, phone) ||
              (r.altPhones ?? []).some((p) => phoneMatches(p, phone))),
        )
        .map((r) => r.id)
    : [];
  const extraRows = phoneIds.length
    ? await prisma.contact.findMany({
        where: { id: { in: phoneIds }, deletedAt: null },
        select,
        orderBy: { name: "asc" },
        take: HITS_PER_GROUP,
      })
    : [];

  return mergeRows(textRows, extraRows, (x, y) =>
    x.name.localeCompare(y.name, "en-NZ", { sensitivity: "base" }),
  ).map((c) => ({
    type: "contact" as const,
    id: c.id,
    title: c.name,
    sub: c.email || (c.phone ? formatNZPhone(c.phone) : "") || c.address || "",
    href: `/admin/contacts/${c.id}`,
  }));
}

/**
 * Bookings whose name or email contains the query, plus (for a phone-shaped
 * query) those whose phone contains it.
 * @param q - Trimmed search query.
 * @param phone - Phone forms of the query, or null when it is not phone-shaped.
 * @returns Up to {@link HITS_PER_GROUP} booking hits, latest start first.
 */
async function searchBookings(q: string, phone: PhoneQuery | null): Promise<SearchHit[]> {
  const contains = { contains: q, mode: "insensitive" as const };
  const select = { id: true, name: true, startAt: true, status: true } as const;

  const [textRows, phoneRows] = await Promise.all([
    prisma.booking.findMany({
      where: { OR: [{ name: contains }, { email: contains }] },
      select,
      orderBy: { startAt: "desc" },
      take: HITS_PER_GROUP,
    }),
    phone
      ? prisma.booking.findMany({
          where: { phone: { isSet: true, not: null } },
          select: { id: true, phone: true },
        })
      : Promise.resolve([]),
  ]);

  const textIds = new Set(textRows.map((r) => r.id));
  const phoneIds = phone
    ? phoneRows.filter((r) => !textIds.has(r.id) && phoneMatches(r.phone, phone)).map((r) => r.id)
    : [];
  const extraRows = phoneIds.length
    ? await prisma.booking.findMany({
        where: { id: { in: phoneIds } },
        select,
        orderBy: { startAt: "desc" },
        take: HITS_PER_GROUP,
      })
    : [];

  // This year's bookings show the time; older ones show the year instead.
  const thisYear = nzTodayKey().slice(0, 4);
  return mergeRows(textRows, extraRows, (x, y) => y.startAt.getTime() - x.startAt.getTime()).map(
    (b) => {
      const when =
        nzDateKey(b.startAt).slice(0, 4) === thisYear
          ? formatDateTimeShort(b.startAt)
          : formatDateShort(b.startAt);
      return {
        type: "booking" as const,
        id: b.id,
        title: b.name,
        sub: `${when} · ${statusLabel(b.status)}`,
        href: `/admin/bookings/${b.id}`,
      };
    },
  );
}

/**
 * Invoices and quotes whose number or client name contains the query. The status
 * shown is the display status, so a SENT invoice past due reads "Overdue" as it
 * does on the invoice list.
 * @param q - Trimmed search query.
 * @returns Up to {@link HITS_PER_GROUP} invoice hits, newest first.
 */
async function searchInvoices(q: string): Promise<SearchHit[]> {
  const contains = { contains: q, mode: "insensitive" as const };
  const rows = await prisma.invoice.findMany({
    where: { OR: [{ number: contains }, { clientName: contains }] },
    select: {
      id: true,
      number: true,
      clientName: true,
      status: true,
      dueDate: true,
      total: true,
      isQuote: true,
      quoteValidUntil: true,
    },
    orderBy: { createdAt: "desc" },
    take: HITS_PER_GROUP,
  });

  return rows.map((inv) => ({
    type: "invoice" as const,
    id: inv.id,
    title: `${inv.number} - ${inv.clientName}`,
    sub: `${statusLabel(deriveInvoiceDisplayStatus(inv))} · ${formatNZD(inv.total)}`,
    href: `/admin/business/invoices/${inv.id}`,
  }));
}

/**
 * Reviews whose first or last name contains the query. A two-word query also
 * matches first name against the first word AND last name against the second, so
 * "jane smi" finds Jane Smith.
 * @param q - Trimmed search query.
 * @returns Up to {@link HITS_PER_GROUP} review hits, newest first.
 */
async function searchReviews(q: string): Promise<SearchHit[]> {
  const mode = "insensitive" as const;
  const or: Prisma.ReviewWhereInput[] = [
    { firstName: { contains: q, mode } },
    { lastName: { contains: q, mode } },
  ];
  const words = q.split(/\s+/).filter(Boolean);
  const [first, last] = words;
  if (words.length === 2 && first && last) {
    or.push({
      AND: [{ firstName: { contains: first, mode } }, { lastName: { contains: last, mode } }],
    });
  }

  const rows = await prisma.review.findMany({
    where: { OR: or },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      status: true,
      contactId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: HITS_PER_GROUP,
  });

  return rows.map((r) => ({
    type: "review" as const,
    id: r.id,
    title: [r.firstName, r.lastName].filter(Boolean).join(" ").trim() || "Anonymous",
    sub: `${statusLabel(r.status)} · ${formatDateShort(r.createdAt)}`,
    href: r.contactId ? `/admin/contacts/${r.contactId}` : "/admin/reviews",
  }));
}

/**
 * Runs the admin search across all four record kinds in parallel. Callers enforce
 * {@link MIN_QUERY_LENGTH} and {@link MAX_QUERY_LENGTH}; this trims but does not cut.
 * @param q - Search query.
 * @returns Hits grouped by kind, each group capped at {@link HITS_PER_GROUP}.
 */
export async function searchAdmin(q: string): Promise<SearchGroups> {
  const query = q.trim();
  const phone = toPhoneQuery(query);
  const [contacts, bookings, invoices, reviews] = await Promise.all([
    searchContacts(query, phone),
    searchBookings(query, phone),
    searchInvoices(query),
    searchReviews(query),
  ]);
  return { contacts, bookings, invoices, reviews };
}
