// scripts/normalise-contact-addresses.ts
/**
 * @file normalise-contact-addresses.ts
 * @description One-off sweep: canonicalises every live contact's address via the
 * Google Geocoding API (same formatted shape the Places autocomplete produces).
 * Ongoing writes are normalised at the source (Google Contacts import/pull);
 * this script fixes rows that predate that. Dry-run by default (prints the
 * would-be changes); pass `--force` to write.
 *
 * Run: dotenv -e .env.local -- tsx scripts/normalise-contact-addresses.ts [--force]
 */

import { PrismaClient } from "@prisma/client";
import { normaliseAddress } from "../src/shared/lib/normalise-address";

const db = new PrismaClient();

/**
 * Geocode-normalises each live contact address and reports/writes the changes.
 * @returns Promise that resolves when the sweep completes.
 */
async function main(): Promise<void> {
  const force = process.argv.includes("--force");

  const contacts = await db.contact.findMany({
    where: { deletedAt: null, address: { not: null } },
    select: { id: true, name: true, address: true },
    orderBy: { name: "asc" },
  });
  console.log(`${contacts.length} live contact(s) with an address.`);

  let changed = 0;
  let unresolved = 0;
  for (const c of contacts) {
    const canonical = await normaliseAddress(c.address);
    if (!canonical) {
      unresolved++;
      console.log(`  ? ${c.name}: no confident match for "${c.address}" (kept as-is)`);
      continue;
    }
    if (canonical === c.address) continue;
    changed++;
    console.log(`  ${force ? "*" : "~"} ${c.name}: "${c.address}" > "${canonical}"`);
    if (force) {
      await db.contact.update({ where: { id: c.id }, data: { address: canonical } });
    }
  }

  console.log(
    `${changed} change(s) ${force ? "written" : "found (dry run - re-run with --force to write)"}, ` +
      `${unresolved} unresolved, ${contacts.length - changed - unresolved} already canonical.`,
  );
}

main().finally(() => db.$disconnect());
