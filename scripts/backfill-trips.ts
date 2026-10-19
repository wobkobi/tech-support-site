// scripts/backfill-trips.ts
// One-off backfill of the trips log from past invoices. `plan` works out address, date,
// remote guess and round-trip km per invoice into a JSON plan (no DB writes); `write` logs
// each "log" row, minus --skip, plus --include (e.g. a job wrongly guessed remote).
// Run with:
//   npx dotenv -e .env.local -- tsx --conditions=react-server scripts/backfill-trips.ts plan <plan.json>
//   npx dotenv -e .env.local -- tsx --conditions=react-server scripts/backfill-trips.ts write <plan.json> [--skip=TTP-1,TTP-2] [--include=TTP-3]

import { MAX_PURPOSE_LEN, MAX_TRIP_KM } from "@/features/business/lib/trips";
import { fetchBookingEvent } from "@/features/calendar/lib/google-calendar";
import { parseDateKey } from "@/shared/lib/date-format";
import { prisma } from "@/shared/lib/prisma";
import { nzDateKey } from "@/shared/lib/timezone-utils";
import { readFileSync, writeFileSync } from "node:fs";

/** What the plan does with one invoice. */
type Action = "log" | "remote" | "no_address" | "no_route" | "exists" | "same_visit";

/** One invoice's line in the plan. */
interface PlanRow {
  invoiceNumber: string;
  clientName: string;
  /** NZ day of the job, YYYY-MM-DD. */
  date: string;
  /** Where the date came from. */
  dateFrom: "event" | "booking" | "issue date";
  address: string;
  addressFrom: "booking" | "event" | "contact" | "none";
  km: number | null;
  bookingId: string | null;
  calendarEventId: string | null;
  action: Action;
}

/** Line wording that marks a job done without driving there. */
const REMOTE_WORDING = /\bremote\b|\bby (text|phone|email)\b|over the phone|phone call/i;

/**
 * The travel origin: Settings base address, else HOME_ADDRESS. Reads the row directly
 * since getSettings needs a request.
 * @returns Origin address, or null when neither is set.
 */
async function baseAddress(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: "settings:identity" } });
  let line = "";
  try {
    const saved = row ? (JSON.parse(row.value) as { baseAddress?: { line?: unknown } }) : null;
    if (typeof saved?.baseAddress?.line === "string") line = saved.baseAddress.line.trim();
  } catch {
    // An unreadable row falls back to the env default, as getSettings does.
  }
  return line || process.env.HOME_ADDRESS || null;
}

/**
 * One Distance Matrix leg's driving km. No departure time: only the distance is wanted.
 * @param origin - Leg start.
 * @param destination - Leg end.
 * @param key - Google Maps server key.
 * @returns Km to one decimal, null when Google finds no route.
 */
async function legKm(origin: string, destination: string, key: string): Promise<number | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", destination);
  url.searchParams.set("units", "metric");
  url.searchParams.set("key", key);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Distance Matrix HTTP ${res.status}`);
  const data = (await res.json()) as {
    rows?: { elements?: { status?: string; distance?: { value?: number } }[] }[];
  };
  const element = data.rows?.[0]?.elements?.[0];
  const metres = element?.status === "OK" ? element.distance?.value : undefined;
  return typeof metres === "number" ? metres / 1000 : null;
}

/**
 * Round-trip km matching the app's lookup: missing return leg mirrors the way there; over
 * the log's limit counts as no route.
 * @param origin - Base address.
 * @param address - Job address.
 * @param key - Google Maps server key.
 * @returns Km to one decimal, or null when Google finds no route.
 */
async function roundTripKm(origin: string, address: string, key: string): Promise<number | null> {
  const destination = `${address.trim().slice(0, 100)}, New Zealand`;
  const there = await legKm(origin, destination, key);
  if (there === null) return null;
  const back = (await legKm(destination, origin, key)) ?? there;
  const km = Math.round((there + back) * 10) / 10;
  return km > 0 && km <= MAX_TRIP_KM ? km : null;
}

/**
 * Flattens a multi-line address to one line, as the calculator's event prefill does.
 * @param raw - Address text, possibly multi-line.
 * @returns Single-line address.
 */
function oneLine(raw: string): string {
  return raw.replace(/,?\s*[\r\n]+\s*/g, ", ").trim();
}

/**
 * Builds the plan: one row per non-voided, non-quote invoice, oldest first.
 * @returns Plan rows.
 */
async function buildPlan(): Promise<PlanRow[]> {
  const origin = await baseAddress();
  const mapsKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!origin || !mapsKey) throw new Error("Base address or GOOGLE_MAPS_SERVER_KEY is not set");
  const [invoices, trips] = await Promise.all([
    prisma.invoice.findMany({
      // Quotes filtered below: on MongoDB `isQuote: { not: true }` skips rows missing the field
      where: { status: { not: "VOIDED" } },
      orderBy: { issueDate: "asc" },
      select: {
        number: true,
        isQuote: true,
        clientName: true,
        issueDate: true,
        lineItems: true,
        bookingId: true,
        calendarEventId: true,
        calendarEventIds: true,
        contactId: true,
      },
    }),
    prisma.trip.findMany({ select: { bookingId: true, calendarEventId: true, notes: true } }),
  ]);

  const rows: PlanRow[] = [];
  const visits = new Set<string>();
  for (const inv of invoices.filter((i) => i.isQuote !== true)) {
    const eventIds =
      inv.calendarEventIds.length > 0
        ? inv.calendarEventIds
        : inv.calendarEventId
          ? [inv.calendarEventId]
          : [];
    const booking = inv.bookingId
      ? await prisma.booking.findUnique({ where: { id: inv.bookingId } })
      : eventIds.length > 0
        ? await prisma.booking.findFirst({ where: { calendarEventId: { in: eventIds } } })
        : null;
    const event = eventIds[0] ? await fetchBookingEvent(eventIds[0]) : null;
    const contact = inv.contactId
      ? await prisma.contact.findUnique({
          where: { id: inv.contactId },
          select: { address: true },
        })
      : null;

    // Address: booking, then the event's location, then the contact's
    let address = "";
    let addressFrom: PlanRow["addressFrom"] = "none";
    if (booking?.address) {
      address = oneLine([booking.unit, booking.address].filter(Boolean).join("/"));
      addressFrom = "booking";
    } else if (event?.location?.trim()) {
      address = oneLine(event.location);
      addressFrom = "event";
    } else if (contact?.address?.trim()) {
      address = oneLine(contact.address);
      addressFrom = "contact";
    }

    // Date: the event's day, then the booking's, then the issue date
    let date = nzDateKey(inv.issueDate);
    let dateFrom: PlanRow["dateFrom"] = "issue date";
    if (event) {
      date = nzDateKey(new Date(event.start));
      dateFrom = "event";
    } else if (booking) {
      date = nzDateKey(booking.startAt);
      dateFrom = "booking";
    }

    const lines = Array.isArray(inv.lineItems)
      ? (inv.lineItems as { description?: unknown }[])
      : [];
    const wording = lines.map((l) => (typeof l.description === "string" ? l.description : ""));
    // A billed travel line means you drove, whatever the other lines say ("TV remote").
    const billedTravel = wording.some((d) => /^(round-trip )?travel\b/i.test(d));
    const remote =
      !billedTravel &&
      (booking?.meetingType === "remote" || wording.some((d) => REMOTE_WORDING.test(d)));

    const linked = trips.some(
      (t) =>
        (booking && t.bookingId === booking.id) ||
        (t.calendarEventId !== null && eventIds.includes(t.calendarEventId)) ||
        t.notes?.includes(inv.number),
    );
    const visitKey = `${date}|${address.toLowerCase()}`;

    let action: Action;
    let km: number | null = null;
    if (linked) action = "exists";
    else if (!address) action = "no_address";
    else if (visits.has(visitKey)) action = "same_visit";
    else {
      km = await roundTripKm(origin, address, mapsKey);
      action = km === null ? "no_route" : remote ? "remote" : "log";
      if (km !== null) visits.add(visitKey);
    }

    rows.push({
      invoiceNumber: inv.number,
      clientName: inv.clientName,
      date,
      dateFrom,
      address,
      addressFrom,
      km,
      bookingId: booking?.id ?? null,
      calendarEventId: eventIds[0] ?? null,
      action,
    });
  }
  return rows;
}

/**
 * Logs a trip for each row the plan, --skip and --include say to.
 * @param rows - Plan rows from the plan pass.
 * @param skip - Invoice numbers to leave out.
 * @param include - Invoice numbers to log even though the plan guessed remote.
 * @returns How many trips were written.
 */
async function writePlan(
  rows: PlanRow[],
  skip: Set<string>,
  include: Set<string>,
): Promise<number> {
  let written = 0;
  for (const row of rows) {
    const wanted =
      row.action === "log" || (row.action === "remote" && include.has(row.invoiceNumber));
    if (!wanted || skip.has(row.invoiceNumber) || row.km === null) continue;
    const date = parseDateKey(row.date);
    if (!date) throw new Error(`Bad date ${row.date} on ${row.invoiceNumber}`);
    await prisma.trip.create({
      data: {
        date,
        km: row.km,
        purpose: (row.clientName.trim() ? `Job: ${row.clientName.trim()}` : "Job").slice(
          0,
          MAX_PURPOSE_LEN,
        ),
        notes: `Logged from invoice ${row.invoiceNumber}.`,
        bookingId: row.bookingId,
        calendarEventId: row.calendarEventId,
      },
    });
    written++;
  }
  return written;
}

/**
 * Reads a comma-separated flag such as --skip=TTP-1,TTP-2.
 * @param name - Flag name without the dashes.
 * @returns The listed values.
 */
function listFlag(name: string): Set<string> {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return new Set(
    arg
      ? arg
          .slice(name.length + 3)
          .split(",")
          .filter(Boolean)
      : [],
  );
}

/**
 * Runs the plan or write pass named on the command line.
 */
async function main(): Promise<void> {
  const [mode, planPath] = process.argv.slice(2);
  if ((mode !== "plan" && mode !== "write") || !planPath) {
    throw new Error("Usage: backfill-trips.ts plan|write <plan.json> [--skip=..] [--include=..]");
  }
  if (mode === "plan") {
    const rows = await buildPlan();
    writeFileSync(planPath, JSON.stringify(rows, null, 2));
    for (const r of rows) {
      console.log(
        [
          r.action.padEnd(10),
          r.invoiceNumber.padEnd(16),
          r.date,
          `(${r.dateFrom})`.padEnd(12),
          r.clientName.slice(0, 28).padEnd(28),
          r.km === null ? "     -" : `${r.km.toFixed(1).padStart(6)} km`,
          r.address ? `${r.address} [${r.addressFrom}]` : "",
        ].join("  "),
      );
    }
    /**
     * Counts the plan rows with one action, for the summary line.
     * @param a - Action to count.
     * @returns How many rows have it.
     */
    const count = (a: Action): number => rows.filter((r) => r.action === a).length;
    console.log(
      `\n${rows.length} invoices: ${count("log")} log, ${count("remote")} remote, ${count("same_visit")} same visit, ${count("no_address")} no address, ${count("no_route")} no route, ${count("exists")} already logged`,
    );
    return;
  }
  const rows = JSON.parse(readFileSync(planPath, "utf8")) as PlanRow[];
  const written = await writePlan(rows, listFlag("skip"), listFlag("include"));
  console.log(`Logged ${written} trips.`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
