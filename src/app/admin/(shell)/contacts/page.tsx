// src/app/admin/(shell)/contacts/page.tsx
/**
 * @description Admin contacts hub. Surfaces booking-sourced field conflicts
 * via {@link enrichContactsFromBookings}, counts pending Google-sync
 * conflicts, loads all contacts plus their linked reviews, and renders the
 * {@link ContactsAdminView} list. The heavier dedup/merge/backfill passes run
 * on the sync-contacts cron and the standalone admin routes, not per page load.
 */
import { ContactsAdminView } from "@/features/admin/components/ContactsAdminView";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { enrichContactsFromBookings } from "@/features/contacts/lib/maintenance";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contacts - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin contacts hub page. Enriches contacts from bookings (for the conflict
 * banner) and loads the list in one parallel pass.
 * @returns Contacts hub page element.
 */
export default async function AdminContactsPage(): Promise<React.ReactElement> {
  await requireAdminAuth();

  // Everything is independent, so run in one parallel pass. Fields enrich
  // writes this pass show on the next load - acceptable lag for a rare write,
  // and the returned conflict list itself is always current.
  const [initialConflicts, pendingConflictsCount, allContacts, reviews] = await Promise.all([
    enrichContactsFromBookings(),
    prisma.contactConflict.count({
      where: { resolvedAt: null },
    }),
    prisma.contact.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        altEmails: true,
        phone: true,
        altPhones: true,
        address: true,
        createdAt: true,
        googleContactId: true,
      },
    }),
    prisma.review.findMany({
      where: { contactId: { not: null } },
      select: {
        id: true,
        text: true,
        firstName: true,
        lastName: true,
        customerRef: true,
        contactId: true,
      },
    }),
  ]);

  const reviewsByContactId = new Map<
    string,
    Array<{
      id: string;
      text: string;
      firstName: string | null;
      lastName: string | null;
      customerRef: string | null;
    }>
  >();
  for (const r of reviews) {
    if (r.contactId) {
      const existing = reviewsByContactId.get(r.contactId) ?? [];
      existing.push({
        id: r.id,
        text: r.text,
        firstName: r.firstName,
        lastName: r.lastName,
        customerRef: r.customerRef ?? null,
      });
      reviewsByContactId.set(r.contactId, existing);
    }
  }

  const contactRows = allContacts.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    altEmails: c.altEmails,
    phone: c.phone ?? null,
    altPhones: c.altPhones,
    address: c.address ?? null,
    createdAt: c.createdAt.toISOString(),
    googleContactId: c.googleContactId ?? null,
    reviews: reviewsByContactId.get(c.id) ?? [],
  }));

  // Booking-field conflicts (amber panel) + Google-sync conflicts (top banner)
  // are both "needs a decision", so the stat counts them together.
  const unsynced = allContacts.filter((c) => !c.googleContactId).length;
  const openConflicts = pendingConflictsCount + initialConflicts.length;
  const reviewCovered = contactRows.filter((c) => c.reviews.length > 0).length;

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Everyone who has booked, been invoiced, or reviewed."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Contacts" value={allContacts.length} />
        <StatCard
          label="Not synced"
          value={unsynced}
          sub={unsynced > 0 ? "to Google" : "all synced"}
          tone={unsynced > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Conflicts"
          value={openConflicts}
          sub={openConflicts > 0 ? "need review" : "none open"}
          tone={openConflicts > 0 ? "critical" : "default"}
        />
        <StatCard label="Reviewed" value={reviewCovered} sub="left a review" tone="success" />
      </div>

      {pendingConflictsCount > 0 && (
        <Link
          href={`/admin/contacts/conflicts`}
          className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100"
        >
          <span>
            <strong>{pendingConflictsCount}</strong> contact{" "}
            {pendingConflictsCount === 1 ? "field has" : "fields have"} a sync conflict between the
            site and Google Contacts.
          </span>
          <span className="font-semibold">Review &amp; resolve →</span>
        </Link>
      )}
      <ContactsAdminView initialConflicts={initialConflicts} contacts={contactRows} />
    </>
  );
}
