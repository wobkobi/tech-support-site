// scripts/backfill-contact-company.ts
// Fill Contact.company from each linked Google contact's first organisation (the regular
// import skips unchanged etags). Run: npm run backfill:company:dry | backfill:company:apply

import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";
import { prisma } from "@/shared/lib/prisma";
import { people as googlePeople, type people_v1 } from "@googleapis/people";

const apply = process.argv.slice(2).includes("--apply");
console.log(`${apply ? "Applying" : "Dry run"} - reading companies from Google Contacts...\n`);

// Every connection's first organisation name, keyed by resource name
const people = googlePeople({ version: "v1", auth: getOAuth2Client() });
const companyByResource = new Map<string, string>();
let pageToken: string | undefined;
do {
  const res: { data: people_v1.Schema$ListConnectionsResponse } =
    await people.people.connections.list({
      resourceName: "people/me",
      personFields: "organizations",
      pageSize: 1000,
      ...(pageToken ? { pageToken } : {}),
    });
  for (const person of res.data.connections ?? []) {
    const company = person.organizations?.[0]?.name?.trim();
    if (person.resourceName && company) companyByResource.set(person.resourceName, company);
  }
  pageToken = res.data.nextPageToken ?? undefined;
} while (pageToken);

const contacts = await prisma.contact.findMany({
  where: { deletedAt: null, googleContactId: { not: null } },
  select: { id: true, name: true, company: true, googleContactId: true, updatedAt: true },
});

let changed = 0;
for (const contact of contacts) {
  const company = contact.googleContactId ? companyByResource.get(contact.googleContactId) : null;
  if (!company || company === contact.company) continue;
  changed++;
  console.log(`${contact.name}: ${contact.company ?? "(none)"} > ${company}`);
  if (apply) {
    // Re-write updatedAt with its own value: an auto-bumped updatedAt would put the
    // row past lastSyncedAt and push every backfilled contact to Google next sync.
    await prisma.contact.update({
      where: { id: contact.id },
      data: { company, updatedAt: contact.updatedAt },
    });
  }
}

console.log(
  `\n${changed} of ${contacts.length} linked contacts ${apply ? "updated" : "would change"}.`,
);
await prisma.$disconnect();
