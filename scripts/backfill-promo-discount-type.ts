// scripts/backfill-promo-discount-type.ts
// Stamps discountType on promos created before the column existed, reading it
// from whichever value column is set. Every reader already falls back to those
// columns, so this is tidying rather than a repair - but leaving the field null
// means the fallback has to stay forever.
// Reads and writes the live database, so it needs .env.local.
// Run with: npm run backfill:promo-types:dry      (writes nothing)
//           npm run backfill:promo-types:apply    (writes)
//
// Two scripts rather than one plus a flag: PowerShell 5.1 strips a bare `--`
// before npm sees it, so a dry run would read exactly like a successful apply.

import { prisma } from "@/shared/lib/prisma";

const apply = process.argv.slice(2).includes("--apply");

/**
 * Stamps discountType on promos that predate the column.
 * @returns Promise that resolves once the pass is complete.
 */
async function main(): Promise<void> {
  const promos = await prisma.promo.findMany({
    // Both shapes count as unstamped: a promo written before the column existed
    // has no key at all, and `discountType: null` alone would skip it.
    where: { OR: [{ discountType: null }, { discountType: { isSet: false } }] },
    select: { id: true, title: true, flatHourlyRate: true, percentDiscount: true },
  });
  console.log(`${promos.length} promo(s) with no discountType.`);

  const planned = promos.map((p) => ({
    id: p.id,
    title: p.title,
    type:
      p.flatHourlyRate !== null
        ? ("flat_hourly" as const)
        : p.percentDiscount !== null
          ? ("percent" as const)
          : null,
  }));

  for (const p of planned) {
    console.log(`  ${p.title}: ${p.type ?? "NO VALUE COLUMN SET - left alone"}`);
  }

  if (!apply) {
    console.log("\nDry run - nothing written. Re-run with :apply to write.");
    return;
  }

  let written = 0;
  for (const p of planned) {
    if (!p.type) continue;
    await prisma.promo.update({ where: { id: p.id }, data: { discountType: p.type } });
    written++;
  }
  console.log(`Stamped ${written} promo(s).`);
}

void main().finally(() => prisma.$disconnect());
