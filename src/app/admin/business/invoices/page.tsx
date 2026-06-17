import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
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

  return (
    <AdminPageLayout current="business-invoices">
      <h1 className="mb-6 text-2xl font-extrabold text-russian-violet">Invoices</h1>
      <InvoicesListView />
    </AdminPageLayout>
  );
}
