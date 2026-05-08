import type { Metadata } from "next";
import type React from "react";
import { requireAdminToken } from "@/shared/lib/auth";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { InvoicesListView } from "@/features/business/components/InvoicesListView";
import { cn } from "@/shared/lib/cn";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Invoices - Business",
  robots: { index: false, follow: false },
};

/**
 * Admin invoices list page.
 * @param root0 - Page props
 * @param root0.searchParams - URL search parameters containing the admin token
 * @returns Invoices list page element
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await searchParams;
  const t = requireAdminToken(token);

  return (
    <AdminPageLayout token={t} current="business-invoices">
      <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>Invoices</h1>
      <InvoicesListView token={t} />
    </AdminPageLayout>
  );
}
