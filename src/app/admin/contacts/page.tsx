// src/app/admin/contacts/page.tsx
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { ContactsAdminView } from "@/features/admin/components/ContactsAdminView";
import { autoMaintain } from "@/features/admin/lib/auto-maintain";
import { requireAdminAuth } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/cn";
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
 * Admin contacts hub page. Runs autoMaintain on load then renders the contacts list.
 * @returns Contacts hub page element.
 */
export default async function AdminContactsPage(): Promise<React.ReactElement> {
  await requireAdminAuth();

  const initialConflicts = await autoMaintain(prisma);

  const pendingConflictsCount = await prisma.contactConflict.count({
    where: { resolvedAt: null },
  });

  const [allContacts, reviews] = await Promise.all([
    prisma.contact.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
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
    phone: c.phone ?? null,
    address: c.address ?? null,
    createdAt: c.createdAt.toISOString(),
    googleContactId: c.googleContactId ?? null,
    reviews: reviewsByContactId.get(c.id) ?? [],
  }));

  return (
    <AdminPageLayout current="contacts">
      <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>
        Contacts
        <span className={cn("ml-3 text-lg font-semibold text-slate-400")}>
          {allContacts.length}
        </span>
      </h1>
      {pendingConflictsCount > 0 && (
        <Link
          href={`/admin/contacts/conflicts`}
          className={cn(
            "mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100",
          )}
        >
          <span>
            <strong>{pendingConflictsCount}</strong> contact{" "}
            {pendingConflictsCount === 1 ? "field has" : "fields have"} a sync conflict between the
            site and Google Contacts.
          </span>
          <span className={cn("font-semibold")}>Review &amp; resolve →</span>
        </Link>
      )}
      <ContactsAdminView initialConflicts={initialConflicts} contacts={contactRows} />
    </AdminPageLayout>
  );
}
