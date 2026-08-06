// src/app/admin/(shell)/contacts/conflicts/page.tsx
/**
 * @description Lists unresolved Google Contacts sync conflicts (fields that
 * changed on both the site DB and Google since the last sync). Joins each
 * conflict to its contact, maps to {@link ConflictRow}s, and renders
 * {@link ContactConflictsView} so the operator can pick the winning value.
 */
import {
  ContactAddressReviewList,
  type AddressReviewRow,
} from "@/features/admin/components/ContactAddressReviewList";
import {
  ContactConflictsView,
  type ConflictRow,
} from "@/features/admin/components/ContactConflictsView";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contact conflicts - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin page listing pending Google Contacts sync conflicts and letting the
 * operator pick which side wins per row.
 * @returns Conflicts page element.
 */
export default async function AdminContactConflictsPage(): Promise<React.ReactElement> {
  await requireAdminAuth();

  const [conflicts, flagged] = await Promise.all([
    prisma.contactConflict.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.contact.findMany({
      where: { addressUnverified: true, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: { id: true, name: true, email: true, address: true, addressCandidates: true },
    }),
  ]);

  // A flagged row always has an address (the flag is only ever set alongside
  // one), but the column is nullable so narrow it rather than asserting.
  const addressRows: AddressReviewRow[] = flagged.flatMap((c) =>
    c.address
      ? [
          {
            contactId: c.id,
            contactName: c.name,
            contactEmail: c.email,
            address: c.address,
            candidates: c.addressCandidates,
          },
        ]
      : [],
  );

  const contactIds = Array.from(new Set(conflicts.map((c) => c.contactId)));
  const contacts =
    contactIds.length > 0
      ? await prisma.contact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const rows: ConflictRow[] = conflicts.map((c) => ({
    id: c.id,
    contactId: c.contactId,
    contactName: contactById.get(c.contactId)?.name ?? "Unknown",
    contactEmail: contactById.get(c.contactId)?.email ?? null,
    field: c.field,
    siteValue: c.siteValue,
    googleValue: c.googleValue,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Contacts", href: "/admin/contacts" }, { label: "Conflicts" }]}
        title="Contact conflicts"
        description="Anything the Google Contacts sync couldn't decide on its own - fields that changed on both sides, and imported addresses that didn't resolve."
      />
      <div className="flex flex-col gap-6">
        <ContactAddressReviewList initial={addressRows} />
        <ContactConflictsView initial={rows} />
      </div>
    </>
  );
}
