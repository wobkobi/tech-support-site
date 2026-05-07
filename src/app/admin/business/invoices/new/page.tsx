import type { Metadata } from "next";
import type React from "react";
import { Suspense } from "react";
import { requireAdminToken } from "@/shared/lib/auth";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { InvoiceBuilderView } from "@/features/business/components/InvoiceBuilderView";
import { cn } from "@/shared/lib/cn";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "New Invoice - Business",
  robots: { index: false, follow: false },
};

/**
 * New invoice builder page with live preview.
 * @param root0 - Page props
 * @param root0.searchParams - URL search parameters containing the admin token
 * @returns New invoice page element
 */
export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await searchParams;
  const t = requireAdminToken(token);

  return (
    <AdminPageLayout token={t} current="business-invoices">
      <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold print:hidden")}>
        New invoice
      </h1>
      <Suspense>
        <InvoiceBuilderView token={t} />
      </Suspense>
    </AdminPageLayout>
  );
}
