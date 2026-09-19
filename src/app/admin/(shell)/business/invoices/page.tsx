// src/app/admin/(shell)/business/invoices/page.tsx
// Admin invoices list page. Renders InvoicesListView, which loads and lists saved
// invoices.

import type { PageQuery } from "@/features/admin/hooks/use-query-sync";
import { InvoicesListView } from "@/features/business/components/InvoicesListView";
import { requireAdminAuth } from "@/shared/lib/auth";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Invoices - Business",
  robots: { index: false, follow: false },
};

/**
 * Admin invoices list page.
 * @param props - Page props.
 * @param props.searchParams - The list's filters, sort and page.
 * @returns Invoices list page element
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const query = await searchParams;

  // InvoicesListView renders its own PageHeader (title + Import/Sync/New actions)
  // - the Drive actions are client handlers coupled to the fetched list, so they
  // live in the client view rather than a separate server-side header.
  return <InvoicesListView query={query} />;
}
