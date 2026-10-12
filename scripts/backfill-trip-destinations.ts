// scripts/backfill-trip-destinations.ts
// One-off fill of Trip.destination and Trip.contactId for trips logged before the trip
// log saved where it went. Each trip is traced to its invoice (the number in its notes,
// else a matching booking or calendar event), then the address is found the same way
// backfill-trips.ts did when it logged them: the booking's address, then the calendar
// event's location, then the contact's saved address. The contact is the invoice's own,
// else the live contact whose email matches the invoice's (an invoice can still point at
// a contact a merge removed). Only empty fields are written. Prints one line per trip and
// writes nothing without --write.
// Run with:
//   npx dotenv -e .env.local -- tsx --conditions=react-server scripts/backfill-trip-destinations.ts [--write]

import { MAX_DESTINATION_LEN } from "@/features/business/lib/trips";
import { fetchBookingEvent } from "@/features/calendar/lib/google-calendar";
import { prisma } from "@/shared/lib/prisma";

/**
 * Invoice number in an auto-logged trip's notes ("Logged from invoice TTP-202627-0003."),
 * with or without the full stop and anything typed after it.
 */
const INVOICE_IN_NOTES = /Logged from invoice ([A-Z0-9-]+)/i;

/**
 * Flattens a multi-line calendar location or a booking's unit and address to one line,
 * the same way the calculator's event prefill does, then drops a part that only repeats
 * the end of the one before it ("...Auckland 0600 New Zealand" then "New Zealand" on the
 * next line).
 * @param raw - Address text, possibly multi-line.
 * @returns Single-line address.
 */
function oneLine(raw: string): string {
  const parts = raw
    .replace(/,?\s*[\r\n]+\s*/g, ", ")
    .split(/\s*,\s*/)
    .filter(Boolean);
  return parts
    .filter((p, i) => {
      const prev = parts[i - 1]?.toLowerCase();
      const part = p.toLowerCase();
      return prev === undefined || (prev !== part && !prev.endsWith(` ${part}`));
    })
    .join(", ")
    .trim();
}

/**
 * The live contact an invoice is for: its own contact when that still exists, else the
 * one whose primary or alternate email is the invoice's.
 * @param contactId - The invoice's contact link, or null.
 * @param clientEmail - The invoice's client email.
 * @returns The contact's id and address, or null when none matches.
 */
async function contactFor(
  contactId: string | null,
  clientEmail: string,
): Promise<{ id: string; address: string | null } | null> {
  const select = { id: true, address: true } as const;
  if (contactId) {
    const own = await prisma.contact.findFirst({
      where: { id: contactId, deletedAt: null },
      select,
    });
    if (own) return own;
  }
  const email = clientEmail.trim().toLowerCase();
  if (!email) return null;
  return prisma.contact.findFirst({
    where: {
      deletedAt: null,
      OR: [{ email: { equals: email, mode: "insensitive" } }, { altEmails: { has: email } }],
    },
    select,
  });
}

/**
 * Plans (and with --write, applies) the fill for every trip missing a destination or
 * contact.
 */
async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  // Filtered here, not in the query: on MongoDB a field the row never had is unset, which
  // a `null` filter does not match.
  const trips = (await prisma.trip.findMany({ orderBy: { date: "asc" } })).filter(
    (t) => !t.destination || !t.contactId,
  );

  let filled = 0;
  for (const t of trips) {
    // Find the invoice that billed the trip's job
    const number = t.notes?.match(INVOICE_IN_NOTES)?.[1];
    const where = number
      ? { number }
      : t.bookingId
        ? { bookingId: t.bookingId }
        : t.calendarEventId
          ? { calendarEventIds: { has: t.calendarEventId } }
          : null;
    const invoice = where
      ? await prisma.invoice.findFirst({
          where,
          select: {
            number: true,
            clientEmail: true,
            bookingId: true,
            calendarEventId: true,
            calendarEventIds: true,
            contactId: true,
          },
        })
      : null;

    const eventIds = invoice
      ? invoice.calendarEventIds.length > 0
        ? invoice.calendarEventIds
        : invoice.calendarEventId
          ? [invoice.calendarEventId]
          : []
      : t.calendarEventId
        ? [t.calendarEventId]
        : [];
    const bookingId = t.bookingId ?? invoice?.bookingId ?? null;
    const booking = bookingId
      ? await prisma.booking.findUnique({
          where: { id: bookingId },
          select: { address: true, unit: true },
        })
      : eventIds.length > 0
        ? await prisma.booking.findFirst({
            where: { calendarEventId: { in: eventIds } },
            select: { address: true, unit: true },
          })
        : null;
    const contact = invoice ? await contactFor(invoice.contactId, invoice.clientEmail) : null;

    // Address: booking, then the event's location, then the contact's
    let address = "";
    let from = "none";
    if (booking?.address) {
      address = oneLine([booking.unit, booking.address].filter(Boolean).join("/"));
      from = "booking";
    } else {
      const event = eventIds[0] ? await fetchBookingEvent(eventIds[0]) : null;
      if (event?.location?.trim()) {
        address = oneLine(event.location);
        from = "event";
      } else if (contact?.address?.trim()) {
        address = oneLine(contact.address);
        from = "contact";
      }
    }

    // Only empty fields are filled, so an address already saved is never replaced.
    const data: { destination?: string; contactId?: string } = {};
    if (!t.destination && address) data.destination = address.slice(0, MAX_DESTINATION_LEN);
    if (!t.contactId && contact) data.contactId = contact.id;

    console.log(
      [
        t.date.toISOString().slice(0, 10),
        (invoice?.number ?? "-").padEnd(16),
        t.purpose.slice(0, 32).padEnd(32),
        data.destination ? `${data.destination} [${from}]` : "(no address)",
        data.contactId ? "+contact" : "",
      ].join("  "),
    );
    if (Object.keys(data).length === 0) continue;
    filled++;
    if (write) await prisma.trip.update({ where: { id: t.id }, data });
  }
  console.log(
    `\n${trips.length} trips checked, ${filled} ${write ? "updated" : "would be updated (run with --write)"}.`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
