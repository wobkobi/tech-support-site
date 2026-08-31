// scripts/backfill-promo-redemptions.ts
// Creates a PromoRedemption for every booking that recorded a promo before
// redemptions were tracked. discountValue stays null: the realised discount was
// never stored, and reconstructing one from a quoted range would be a guess.
// Booking has no contactId column, so backfilled rows carry no customer, which
// means per-customer caps will only ever see redemptions recorded from now on.
// Reads and writes the live database, so it needs .env.local.
// Run with: npm run backfill:promo-redemptions:dry      (writes nothing)
//           npm run backfill:promo-redemptions:apply    (writes)
//
// Two scripts rather than one plus a flag: PowerShell 5.1 strips a bare `--`
// before npm sees it, so a dry run would read exactly like a successful apply.

import { prisma } from "@/shared/lib/prisma";

const apply = process.argv.slice(2).includes("--apply");

/**
 * Backfills redemptions from booking promo snapshots.
 * @returns Promise that resolves once the pass is complete.
 */
async function main(): Promise<void> {
  const bookings = await prisma.booking.findMany({
    where: { promoIdAtBooking: { not: null } },
    select: { id: true, promoIdAtBooking: true, createdAt: true },
  });

  console.log(`${bookings.length} booking(s) carry a promo snapshot.`);

  // Re-running must not double-count, so skip any booking already recorded.
  const existing = await prisma.promoRedemption.findMany({
    where: { bookingId: { in: bookings.map((b) => b.id) } },
    select: { bookingId: true },
  });
  const seen = new Set(existing.map((r) => r.bookingId));

  const todo = bookings.filter((b) => !seen.has(b.id));
  console.log(`${todo.length} still to record, ${seen.size} already present.`);

  if (!apply) {
    for (const b of todo.slice(0, 20)) {
      console.log(`  would record promo ${b.promoIdAtBooking} for booking ${b.id}`);
    }
    if (todo.length > 20) console.log(`  ... and ${todo.length - 20} more`);
    console.log("\nDry run - nothing written. Re-run with :apply to write.");
    return;
  }

  let written = 0;
  for (const b of todo) {
    await prisma.promoRedemption.create({
      data: {
        promoId: b.promoIdAtBooking!,
        bookingId: b.id,
        // Unknown for historical rows - see the file header.
        discountValue: null,
        // Date the promo was actually used, not the date of this backfill.
        redeemedAt: b.createdAt,
      },
    });
    written++;
  }
  console.log(`Wrote ${written} redemption(s).`);
}

void main().finally(() => prisma.$disconnect());
