// scripts/check-promo-limits.ts
// Promo limits, caps and redemption bookkeeping against an in-memory Prisma stand-in, plus the
// offer wording, validation and NZ-date form helpers. No real DB.
// Run with: npm test -- promo-limits

import {
  endIsoToInclusiveDate,
  endOfDayISO,
  startOfDayISO,
  toDateInput,
} from "@/features/business/lib/promo-form";
import { validateDiscount, validateTiers } from "@/features/business/lib/promo-validation";
import type { ActivePromo } from "@/features/business/lib/promos";
import { nzWallClockUtc } from "@/shared/lib/timezone-utils";
import { expect, expectEqual, finish } from "./lib/harness.js";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
type OrderBy = Array<Record<string, "asc" | "desc">>;

/** The fake collections, keyed by Prisma model name. */
const db: Record<string, Row[]> = {};
let nextId = 1;

/** Empties every collection between scenarios. */
function reset(): void {
  for (const name of ["promo", "promoRedemption", "booking", "invoice", "contact"]) db[name] = [];
}

/**
 * A comparable number for a Date or numeric value.
 * @param value - Stored or query value.
 * @returns Milliseconds for a Date, else the number.
 */
function num(value: unknown): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

/**
 * One field against one condition, with Prisma-on-Mongo semantics: `null` matches only a stored
 * null (not an unset field), and `not` never matches a null or unset value.
 * @param value - The stored value; undefined when the field is unset.
 * @param cond - A literal or an operator object.
 * @returns Whether the field passes.
 */
function matchesField(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null;
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
  if (typeof cond !== "object" || Array.isArray(cond)) return value === cond;
  const ops = cond as Record<string, unknown>;
  /**
   * Lowercases a string when the condition asks for an insensitive match.
   * @param v - Value to normalise.
   * @returns The value to compare.
   */
  const norm = (v: unknown): unknown =>
    ops.mode === "insensitive" && typeof v === "string" ? v.toLowerCase() : v;
  return Object.entries(ops).every(([op, arg]) => {
    switch (op) {
      case "mode":
        return true;
      case "equals":
        return norm(value) === norm(arg);
      case "isSet":
        return (value !== undefined) === arg;
      case "in":
        return (arg as unknown[]).includes(value);
      case "not":
        return value !== null && value !== undefined && (arg === null || value !== arg);
      case "has":
        return Array.isArray(value) && value.includes(arg);
      case "gt":
        return value != null && num(value) > num(arg);
      case "gte":
        return value != null && num(value) >= num(arg);
      case "lt":
        return value != null && num(value) < num(arg);
      case "lte":
        return value != null && num(value) <= num(arg);
      default:
        throw new Error(`fake prisma: unsupported operator "${op}"`);
    }
  });
}

/**
 * A row against a where clause, with AND and OR.
 * @param row - Stored row.
 * @param where - Prisma where clause.
 * @returns Whether the row matches.
 */
function matchesWhere(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") {
      return (Array.isArray(cond) ? cond : [cond]).every((w) => matchesWhere(row, w as Where));
    }
    if (key === "OR") return (cond as Where[]).some((w) => matchesWhere(row, w));
    return matchesField(row[key], cond);
  });
}

/** What a fake model method takes, as Prisma passes it. */
interface QueryArgs {
  where?: Where;
  orderBy?: OrderBy;
  data?: Row;
}

/**
 * The rows of one model matching a query, in the requested order.
 * @param name - Model name.
 * @param args - Filter and sort keys; the first key that differs decides.
 * @returns Copies of the matching rows.
 */
function query(name: string, args?: QueryArgs): Row[] {
  const rows = (db[name] ?? []).filter((row) => matchesWhere(row, args?.where));
  const order = args?.orderBy ?? [];
  rows.sort((a, b) => {
    for (const key of order) {
      const [field, dir] = Object.entries(key)[0]!;
      const diff = num(a[field]) - num(b[field]);
      if (diff !== 0) return dir === "desc" ? -diff : diff;
    }
    return 0;
  });
  return rows.map((row) => ({ ...row }));
}

/**
 * The model methods the promo code calls.
 * @param name - Model name.
 * @returns A delegate with findMany, findFirst, findUnique, count, create, update, deleteMany.
 */
function model(name: string): Record<string, (args?: QueryArgs) => Promise<unknown>> {
  /**
   * The model's live collection, read fresh since deleteMany replaces it.
   * @returns The stored rows.
   */
  const rows = (): Row[] => (db[name] ??= []);
  return {
    /**
     * Every matching row, in order.
     * @param args - Filter and sort.
     * @returns The rows.
     */
    findMany: async (args) => query(name, args),
    /**
     * The first matching row.
     * @param args - Filter and sort.
     * @returns The row, or null.
     */
    findFirst: async (args) => query(name, args)[0] ?? null,
    /**
     * The row matching a unique filter.
     * @param args - Filter.
     * @returns The row, or null.
     */
    findUnique: async (args) => query(name, args)[0] ?? null,
    /**
     * How many rows match.
     * @param args - Filter.
     * @returns The count.
     */
    count: async (args) => query(name, args).length,
    /**
     * Stores a row with a fresh id.
     * @param args - The data to store.
     * @returns The stored row.
     */
    create: async (args) => {
      const row = { id: `${name}-${nextId++}`, ...args?.data };
      rows().push(row);
      return { ...row };
    },
    /**
     * Merges data into the first matching row.
     * @param args - Filter and data.
     * @returns The updated row.
     */
    update: async (args) => {
      const row = rows().find((r) => matchesWhere(r, args?.where));
      if (!row) throw new Error(`fake prisma: no ${name} to update`);
      Object.assign(row, args?.data);
      return { ...row };
    },
    /**
     * Removes every matching row.
     * @param args - Filter.
     * @returns How many went.
     */
    deleteMany: async (args) => {
      const before = rows().length;
      db[name] = rows().filter((row) => !matchesWhere(row, args?.where));
      return { count: before - rows().length };
    },
  };
}

/**
 * A full promo row with neutral defaults: automatic, 10% off, no caps or windows, live all
 * of 2026-2027.
 * @param fields - Columns to override.
 * @returns The row as Prisma would return it.
 */
function promoRow(fields: Row): Row {
  return {
    title: `Promo ${String(fields.id)}`,
    description: null,
    startAt: new Date("2026-01-01T00:00:00Z"),
    endAt: new Date("2027-12-31T00:00:00Z"),
    kind: "automatic",
    code: null,
    discountType: "percent",
    flatHourlyRate: null,
    percentDiscount: 0.1,
    fixedAmount: null,
    travelPercent: null,
    isActive: true,
    priority: 0,
    tiers: [],
    lockedDeltas: [],
    maxRedemptions: null,
    perCustomerLimit: null,
    minSpend: null,
    newCustomersOnly: false,
    activeWeekdays: [],
    activeFromMinute: null,
    activeToMinute: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...fields,
  };
}

/**
 * A promo in the cross-app shape, for the wording helpers.
 * @param fields - Fields to override.
 * @returns The promo.
 */
function activePromo(fields: Partial<ActivePromo>): ActivePromo {
  return {
    id: "p",
    title: "Promo",
    description: null,
    startAt: "2026-01-01T00:00:00.000Z",
    endAt: "2027-12-31T00:00:00.000Z",
    kind: "automatic",
    code: null,
    discountType: "percent",
    flatHourlyRate: null,
    percentDiscount: 0.1,
    fixedAmount: null,
    travelPercent: null,
    minSpend: null,
    tiers: [],
    activeWeekdays: [],
    activeFromMinute: null,
    activeToMinute: null,
    ...fields,
  };
}

/**
 * The redemption rows for one booking, as comparable text.
 * @param bookingId - Booking to list.
 * @returns "promoId:invoiceId" per row, invoiceId "-" while unsettled.
 */
function bookingRows(bookingId: string): string[] {
  return (db.promoRedemption ?? [])
    .filter((r) => r.bookingId === bookingId)
    .map((r) => `${String(r.promoId)}:${r.invoiceId == null ? "-" : String(r.invoiceId)}`)
    .sort();
}

// Tuesday 3 Nov 2026 and the days around it, 10am NZ.
const TUESDAY = nzWallClockUtc(2026, 11, 3, 10);
const WEDNESDAY = nzWallClockUtc(2026, 11, 4, 10);
const NEXT_TUESDAY = nzWallClockUtc(2026, 11, 10, 10);
const BOOKED = new Date("2026-09-01T00:00:00Z");

/** Runs every scenario and exits non-zero if any failed. */
async function main(): Promise<void> {
  console.log("promo limits fixtures\n");

  reset();
  (globalThis as unknown as { prisma?: unknown }).prisma = Object.fromEntries(
    Object.keys(db).map((name) => [name, model(name)]),
  );
  // Imported after the stand-in is on globalThis, which the prisma singleton reads first.
  const {
    describePromoDiscount,
    describePromoOffer,
    describePromoTerms,
    loadAdvertisedPromo,
    resolvePromo,
    bookingPromoColumns,
    summariseForBanner,
  } = await import("@/features/business/lib/promos");
  const {
    applyMovedBookingPromo,
    judgeMovedBookingPromo,
    releaseInvoiceRedemptions,
    settlePromoRedemption,
  } = await import("@/features/business/lib/promo-redemption");

  /**
   * The promo id a customer would get at a slot.
   * @param context - Slot, customer and booking.
   * @param context.at - Appointment instant, or null for no slot yet.
   * @param context.email - Customer email.
   * @param context.bookingId - Booking being priced.
   * @returns The winning promo id, or null.
   */
  const winner = async (context: {
    at: Date | null;
    email?: string;
    bookingId?: string;
  }): Promise<string | null> => (await resolvePromo({ ...context, bookedAt: BOOKED }))?.id ?? null;

  // ---- #2 New customers only: an invoice on file makes a returning customer ----
  reset();
  db.promo!.push(promoRow({ id: "new", newCustomersOnly: true }));
  db.contact!.push({
    id: "c1",
    email: "known@example.com",
    altEmails: [],
    deletedAt: null,
  });
  db.invoice!.push(
    { id: "i1", clientEmail: "Inv@Example.com", status: "SENT", isQuote: false, bookingId: null },
    { id: "i2", clientEmail: "voided@example.com", status: "VOIDED", isQuote: false },
    { id: "i3", clientEmail: "quoted@example.com", status: "DRAFT", isQuote: true },
    { id: "i4", clientEmail: "own@example.com", status: "SENT", bookingId: "b-own" },
    { id: "i5", clientEmail: "other@example.com", status: "PAID", contactId: "c1" },
  );
  expectEqual("#2 a first-timer gets it", await winner({ at: TUESDAY, email: "new@x.nz" }), "new");
  expectEqual(
    "#2 an invoice by email (any case) makes a returning customer",
    await winner({ at: TUESDAY, email: "inv@example.com" }),
    null,
  );
  expectEqual(
    "#2 a voided invoice doesn't count",
    await winner({ at: TUESDAY, email: "voided@example.com" }),
    "new",
  );
  expectEqual(
    "#2 a quote doesn't count",
    await winner({ at: TUESDAY, email: "quoted@example.com" }),
    "new",
  );
  expectEqual(
    "#2 the invoice for the booking being priced isn't an earlier job",
    await winner({ at: TUESDAY, email: "own@example.com", bookingId: "b-own" }),
    "new",
  );
  expectEqual(
    "#2 an invoice on the contact counts under another address",
    await winner({ at: TUESDAY, email: "known@example.com" }),
    null,
  );

  // ---- #3 The advertised promo skips one whose total cap is used up ----
  reset();
  db.promo!.push(
    promoRow({ id: "capped", priority: 5, maxRedemptions: 1 }),
    promoRow({ id: "open", priority: 0 }),
  );
  db.promoRedemption!.push({ id: "r1", promoId: "capped", bookingId: "b1", invoiceId: null });
  expectEqual("#3 a full cap drops to the next promo", (await loadAdvertisedPromo())?.id, "open");
  db.promoRedemption![0]!.invoiceId = "i1";
  db.promoRedemption![0]!.discountValue = 0;
  expectEqual(
    "#3 a $0 settlement gave nothing, so the cap is free again",
    (await loadAdvertisedPromo())?.id,
    "capped",
  );

  // ---- #5 Unearned booking-time rows don't fill a spend-floor or tiered promo's cap ----
  reset();
  db.promo!.push(
    promoRow({ id: "floor", priority: 5, maxRedemptions: 1, minSpend: 100 }),
    promoRow({
      id: "tiered",
      priority: 4,
      maxRedemptions: 1,
      tiers: [
        {
          minSpend: 150,
          flatHourlyRate: null,
          percentDiscount: 0.2,
          fixedAmount: null,
          travelPercent: null,
        },
      ],
    }),
    promoRow({ id: "plain", priority: 3, maxRedemptions: 1 }),
  );
  db.promoRedemption!.push(
    { id: "r1", promoId: "floor", bookingId: "b1", invoiceId: null },
    { id: "r2", promoId: "floor", bookingId: "b2" },
    { id: "r3", promoId: "tiered", bookingId: "b3", invoiceId: null },
    { id: "r4", promoId: "plain", bookingId: "b4", invoiceId: null },
  );
  expectEqual(
    "#5 booking-time rows on a spend-floor promo leave its cap open",
    (await loadAdvertisedPromo())?.id,
    "floor",
  );
  expectEqual(
    "#5 and the quote still gets it",
    await winner({ at: TUESDAY, email: "a@x.nz" }),
    "floor",
  );
  db.promoRedemption!.push({
    id: "r5",
    promoId: "floor",
    bookingId: "b5",
    invoiceId: "i5",
    discountValue: 20,
  });
  expectEqual(
    "#5 an invoiced use fills it; a tiered promo's booking row doesn't",
    (await loadAdvertisedPromo())?.id,
    "tiered",
  );
  db.promo!.splice(1, 1);
  expectEqual(
    "#5 a plain promo's booking-time row still counts",
    (await loadAdvertisedPromo())?.id ?? null,
    null,
  );

  // ---- #4 and #14 Void releases; a re-issue or second invoice settles its own row ----
  reset();
  db.promo!.push(promoRow({ id: "u" }));
  db.promoRedemption!.push({ id: "r1", promoId: "u", bookingId: "b2", invoiceId: null });
  db.invoice!.push({ id: "inv1", bookingId: "b2", status: "SENT", isQuote: false });
  await settlePromoRedemption({
    promoId: "u",
    invoiceId: "inv1",
    bookingId: "b2",
    discountValue: 15,
  });
  expectEqual("#4 settling takes over the booking row", bookingRows("b2"), ["u:inv1"]);
  db.invoice![0]!.status = "VOIDED";
  await releaseInvoiceRedemptions("inv1");
  expectEqual("#4 voiding the only invoice frees the booking's use", bookingRows("b2"), []);
  db.invoice!.push({ id: "inv2", bookingId: "b2", status: "SENT", isQuote: false });
  await settlePromoRedemption({
    promoId: "u",
    invoiceId: "inv2",
    bookingId: "b2",
    discountValue: 15,
  });
  expectEqual("#4 the re-issue settles a fresh row", bookingRows("b2"), ["u:inv2"]);

  db.promoRedemption!.push({ id: "r9", promoId: "u", bookingId: "b3", invoiceId: null });
  db.invoice!.push(
    { id: "inv3", bookingId: "b3", status: "SENT", isQuote: false },
    { id: "inv4", bookingId: "b3", status: "SENT" },
  );
  await settlePromoRedemption({
    promoId: "u",
    invoiceId: "inv3",
    bookingId: "b3",
    discountValue: 10,
  });
  await settlePromoRedemption({
    promoId: "u",
    invoiceId: "inv4",
    bookingId: "b3",
    discountValue: 5,
  });
  expectEqual("#14 a second invoice on a settled booking records its own row", bookingRows("b3"), [
    "u:inv3",
    "u:inv4",
  ]);
  expect(
    "#14 the first invoice's row was not rewritten",
    db.promoRedemption!.some((r) => r.id === "r9" && r.invoiceId === "inv3"),
  );
  await releaseInvoiceRedemptions("inv3");
  expectEqual("#4 voiding one of two live invoices keeps the other's", bookingRows("b3"), [
    "u:inv4",
  ]);

  // A leftover unsettled row stays while a live invoice bills the booking; a quote doesn't hold it.
  db.promoRedemption!.push(
    { id: "r10", promoId: "u", bookingId: "b5", invoiceId: null },
    { id: "r11", promoId: "u", bookingId: "b5", invoiceId: "inv5", discountValue: 8 },
    { id: "r12", promoId: "u", bookingId: "b6" },
    { id: "r13", promoId: "u", bookingId: "b6", invoiceId: "inv6", discountValue: 8 },
  );
  db.invoice!.push(
    { id: "inv5", bookingId: "b5", status: "VOIDED", isQuote: false },
    { id: "inv5b", bookingId: "b5", status: "PAID", isQuote: false },
    { id: "inv6", bookingId: "b6", status: "VOIDED", isQuote: false },
    { id: "q6", bookingId: "b6", status: "DRAFT", isQuote: true },
  );
  await releaseInvoiceRedemptions("inv5");
  expectEqual("#4 another live invoice keeps the booking's use", bookingRows("b5"), ["u:-"]);
  await releaseInvoiceRedemptions("inv6");
  expectEqual("#4 a quote alone doesn't, unset invoiceId included", bookingRows("b6"), []);

  // ---- #8 A reschedule re-judges the weekday/time window ----
  reset();
  db.promo!.push(
    promoRow({ id: "tue", title: "Tuesday deal", priority: 5, activeWeekdays: [2] }),
    promoRow({ id: "any", title: "Any day", priority: 0 }),
  );
  const tuesdayPromo = await resolvePromo({ at: TUESDAY, bookedAt: BOOKED });
  const booked = {
    id: "b8",
    email: "mover@example.com",
    createdAt: BOOKED,
    ...bookingPromoColumns(tuesdayPromo),
  };
  const sameDay = await judgeMovedBookingPromo(booked, NEXT_TUESDAY);
  expectEqual(
    "#8 another Tuesday keeps the booked promo",
    [sameDay.changed, sameDay.promo?.id, sameDay.lapsedTitle],
    [false, "tue", null],
  );
  const offDay = await judgeMovedBookingPromo(booked, WEDNESDAY);
  expectEqual(
    "#8 a Wednesday drops it for the promo that covers the new day",
    [offDay.changed, offDay.promo?.id, offDay.lapsedTitle],
    [true, "any", "Tuesday deal"],
  );
  db.promo!.pop();
  const nothing = await judgeMovedBookingPromo(booked, WEDNESDAY);
  expectEqual(
    "#8 with nothing else live it drops to no promo and names the lapsed one",
    [nothing.changed, nothing.promo, nothing.lapsedTitle],
    [true, null, "Tuesday deal"],
  );
  const gained = await judgeMovedBookingPromo({ ...booked, ...bookingPromoColumns(null) }, TUESDAY);
  expectEqual(
    "#8 a booking without one gains it by moving onto a Tuesday",
    [gained.changed, gained.promo?.id, gained.lapsedTitle],
    [true, "tue", null],
  );
  db.promoRedemption!.push({ id: "r1", promoId: "tue", bookingId: "b8", invoiceId: null });
  await applyMovedBookingPromo("b8", nothing);
  expectEqual("#8 a lapsed promo's booking-time use is released", bookingRows("b8"), []);
  await applyMovedBookingPromo("b8", gained, "c8");
  expectEqual("#8 a gained promo records a use", bookingRows("b8"), ["tue:-"]);

  // ---- #9 With no slot yet, an unrestricted promo beats a restricted one ranked above it ----
  reset();
  db.promo!.push(
    promoRow({ id: "tue", priority: 5, activeWeekdays: [2] }),
    promoRow({ id: "any", priority: 0 }),
  );
  expectEqual("#9 no slot: the unrestricted promo prices", await winner({ at: null }), "any");
  expectEqual(
    "#9 a Tuesday slot still gets the Tuesday promo",
    await winner({ at: TUESDAY }),
    "tue",
  );
  db.promo!.pop();
  expectEqual(
    "#9 the restricted one comes back when nothing else applies",
    await winner({ at: null }),
    "tue",
  );

  // ---- #11 Validation ----
  expectEqual(
    "#11 a stray value column is refused",
    validateDiscount({ discountType: "percent", percentDiscount: 0.2, flatHourlyRate: 60 }),
    "flatHourlyRate must be empty for a percent promo",
  );
  expectEqual(
    "#11 a flat rate at the Standard rate is refused",
    validateDiscount({ discountType: "flat_hourly", flatHourlyRate: 75 }, { standardRate: 75 }),
    "flatHourlyRate must be below the Standard rate ($75/hr), or it takes nothing off",
  );
  expectEqual(
    "#11 one below it passes",
    validateDiscount({ discountType: "flat_hourly", flatHourlyRate: 65 }, { standardRate: 75 }),
    null,
  );
  const typedTier = { minSpend: 100, percentDiscount: 0.2, discountType: "flat_hourly" };
  expectEqual(
    "#11 a tier's own discountType is ignored",
    validateTiers("percent", null, [typedTier]),
    null,
  );
  expectEqual(
    "#11 a tier's flat rate is held to the Standard rate too",
    validateTiers("flat_hourly", null, [{ minSpend: 100, flatHourlyRate: 80 }], {
      standardRate: 75,
    }),
    "tier at $100: flatHourlyRate must be below the Standard rate ($75/hr), or it takes nothing off",
  );

  // ---- #12 Percentages read as the real number ----
  expectEqual(
    "#12 12.5% off",
    describePromoDiscount(activePromo({ percentDiscount: 0.125 })),
    "12.5% off",
  );
  expectEqual(
    "#12 12.5% off travel",
    describePromoDiscount(
      activePromo({ discountType: "free_travel", percentDiscount: null, travelPercent: 0.875 }),
    ),
    "12.5% off travel",
  );
  expectEqual(
    "#12 float noise is cleaned",
    describePromoDiscount(activePromo({ percentDiscount: 0.07 })),
    "7% off",
  );

  // ---- #10 Who-can-use-it wording ----
  expectEqual(
    "#10 new customers and once per customer",
    describePromoOffer(activePromo({ newCustomersOnly: true, perCustomerLimit: 1 })),
    "10% off for new customers, once per customer",
  );
  expectEqual(
    "#10 several uses per customer",
    describePromoOffer(activePromo({ perCustomerLimit: 3, minSpend: 100 })),
    "10% off on jobs over $100, up to 3 times per customer",
  );
  expectEqual(
    "#10 a code check names the days as well",
    describePromoTerms(activePromo({ activeWeekdays: [2], perCustomerLimit: 1 })),
    "10% off, Tuesdays only, once per customer",
  );
  expect(
    "#10 the banner carries the limit after the days",
    summariseForBanner(activePromo({ activeWeekdays: [2], newCustomersOnly: true }), {
      fixedDate: true,
    }).startsWith("10% off for new customers if you book by"),
  );

  // ---- #15c Promo-form dates are NZ midnights, whatever the browser's zone ----
  expectEqual("#15c NZDT start of day", startOfDayISO("2026-10-31"), "2026-10-30T11:00:00.000Z");
  expectEqual("#15c NZST start of day", startOfDayISO("2026-06-15"), "2026-06-14T12:00:00.000Z");
  expectEqual(
    "#15c the end is the next NZ midnight",
    endOfDayISO("2026-10-31"),
    "2026-10-31T11:00:00.000Z",
  );
  expectEqual(
    "#15c and reads back as the inclusive last day",
    endIsoToInclusiveDate(endOfDayISO("2026-10-31")),
    "2026-10-31",
  );
  expectEqual(
    "#15c a stored start shows its NZ date",
    toDateInput("2026-10-30T11:00:00.000Z"),
    "2026-10-31",
  );

  finish();
}

void main();
