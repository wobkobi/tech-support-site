// scripts/backfill-invoice-contacts.ts
// Attaches historical invoices to the Contact that matches their client email.
// Invoice.contactId was only ever set when the add-to-contacts prompt fired,
// which happens only for an email the database has never seen, so invoices for
// repeat customers were never linked to them.
// Matches primary email and altEmails, case-insensitively, skipping deleted
// contacts. An email that matches nobody is left alone rather than guessed at.
// Reads and writes the live database, so it needs .env.local.
// Run with: npm run backfill:invoice-contacts:dry      (writes nothing)
//           npm run backfill:invoice-contacts:apply    (writes)
//
// Two scripts rather than one plus a flag: PowerShell 5.1 strips a bare `--`
// before npm sees it, so a dry run would read exactly like a successful apply.

import { prisma } from "@/shared/lib/prisma";

const apply = process.argv.slice(2).includes("--apply");

/**
 * Links unlinked invoices to their customer by email.
 * @returns Promise that resolves once the pass is complete.
 */
async function main(): Promise<void> {
  const invoices = await prisma.invoice.findMany({
    // Both shapes count as unlinked. In MongoDB `contactId: null` matches only
    // documents where the key is present and null; invoices written before the
    // field existed have no key at all, and querying null alone skips them.
    where: { OR: [{ contactId: null }, { contactId: { isSet: false } }] },
    select: { id: true, number: true, clientEmail: true },
  });
  console.log(`${invoices.length} invoice(s) with no contact.`);

  const contacts = await prisma.contact.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, email: true, altEmails: true },
  });

  // One lookup keyed by every address a contact uses, so an invoice raised
  // against a secondary address still finds its person.
  const byEmail = new Map<string, { id: string; name: string }>();
  for (const c of contacts) {
    for (const e of [c.email, ...c.altEmails]) {
      if (e) byEmail.set(e.toLowerCase(), { id: c.id, name: c.name });
    }
  }

  const matched: Array<{ id: string; number: string; contactId: string; name: string }> = [];
  const unmatched: string[] = [];
  for (const inv of invoices) {
    const hit = inv.clientEmail ? byEmail.get(inv.clientEmail.toLowerCase()) : undefined;
    if (hit) matched.push({ id: inv.id, number: inv.number, contactId: hit.id, name: hit.name });
    else unmatched.push(`${inv.number} <${inv.clientEmail || "no email"}>`);
  }

  console.log(`${matched.length} can be linked, ${unmatched.length} match no contact.`);

  if (!apply) {
    for (const m of matched.slice(0, 20)) {
      console.log(`  would link ${m.number} > ${m.name}`);
    }
    if (matched.length > 20) console.log(`  ... and ${matched.length - 20} more`);
    if (unmatched.length) {
      console.log("\nno matching contact (left alone):");
      for (const u of unmatched.slice(0, 10)) console.log(`  ${u}`);
      if (unmatched.length > 10) console.log(`  ... and ${unmatched.length - 10} more`);
    }
    console.log("\nDry run - nothing written. Re-run with :apply to write.");
    return;
  }

  let written = 0;
  for (const m of matched) {
    await prisma.invoice.update({ where: { id: m.id }, data: { contactId: m.contactId } });
    written++;
  }
  console.log(`Linked ${written} invoice(s).`);
}

void main().finally(() => prisma.$disconnect());
