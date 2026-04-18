// src/app/admin/contacts/page.tsx
import type { Metadata } from "next";
import type React from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/shared/lib/prisma";
import { isValidAdminToken } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/cn";
import { AdminSidebar } from "@/features/admin/components/AdminSidebar";
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

  if (!isValidAdminToken(token ?? null)) {
    console.warn("[admin/contacts] Invalid token attempt", { tokenPresent: Boolean(token) });
    notFound();
  }

  const t = token!;

  // Run maintenance: backfill contacts, link reviews, enrich fields, collect conflicts.
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
    <div className={cn("flex min-h-screen")}>
      <AdminSidebar token={t} current="contacts" />

      <div className={cn("ml-56 flex-1 bg-slate-50")}>
        <div className={cn("mx-auto max-w-7xl px-6 py-8")}>
          <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>
            Contacts
            <span className={cn("ml-3 text-lg font-semibold text-slate-400")}>
              {allContacts.length}
            </span>
          </h1>

          <ContactsAdminView initialConflicts={initialConflicts} contacts={contactRows} token={t} />
        </div>
      </div>
    </div>
  );
}
