// src/app/admin/contacts/page.tsx
import type { Metadata } from "next";
import type React from "react";
import { prisma } from "@/shared/lib/prisma";
import { requireAdminToken } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/cn";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { ContactsAdminView } from "@/features/admin/components/ContactsAdminView";
import { autoMaintain } from "@/features/admin/lib/auto-maintain";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contacts - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin contacts hub page. Runs autoMaintain on load then renders the contacts list.
 * @param root0 - Page props.
 * @param root0.searchParams - URL search parameters (contains token).
 * @returns Contacts hub page element.
 */
export default async function AdminContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await searchParams;
  const t = requireAdminToken(token);

  const initialConflicts = await autoMaintain(prisma);

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
    <AdminPageLayout token={t} current="contacts">
      <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>
        Contacts
        <span className={cn("ml-3 text-lg font-semibold text-slate-400")}>
          {allContacts.length}
        </span>
      </h1>
      <ContactsAdminView initialConflicts={initialConflicts} contacts={contactRows} token={t} />
    </AdminPageLayout>
  );
}
