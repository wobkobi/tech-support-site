// src/app/admin/contacts/conflicts/page.tsx
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import {
  ContactConflictsView,
  type ConflictRow,
} from "@/features/admin/components/ContactConflictsView";
import { requireAdminAuth } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/cn";
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

  const conflicts = await prisma.contactConflict.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

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
    <AdminPageLayout current="contacts">
      <h1 className={cn("mb-2 text-2xl font-extrabold text-russian-violet")}>Contact conflicts</h1>
      <p className={cn("mb-6 text-sm text-slate-500")}>
        Fields where the site DB and Google Contacts both changed since the last sync. Pick which
        value should win - the chosen value is written to both sides and the conflict is closed.
      </p>
      <ContactConflictsView initial={rows} />
    </AdminPageLayout>
  );
}
