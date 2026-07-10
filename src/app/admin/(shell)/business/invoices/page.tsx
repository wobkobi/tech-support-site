// src/app/admin/(shell)/business/invoices/page.tsx
/**
 * @description Admin invoices list page. Renders {@link InvoicesListView}, which
 * loads and lists saved invoices.
 */
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
 * @returns Invoices list page element
 */
export default async function InvoicesPage(): Promise<React.ReactElement> {
  await requireAdminAuth();

  // InvoicesListView renders its own PageHeader (title + Import/Sync/New actions)
  // - the Drive actions are client handlers coupled to the fetched list, so they
  // live in the client view rather than a separate server-side header.
  return <InvoicesListView />;
}
