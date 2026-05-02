import type { Metadata } from "next";
import type React from "react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { isValidAdminToken } from "@/shared/lib/auth";
import { AdminSidebar } from "@/features/admin/components/AdminSidebar";
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
  if (!isValidAdminToken(token ?? null)) notFound();
  const t = token!;

  return (
    <div className={cn("flex min-h-screen")}>
      <AdminSidebar token={t} current="business-invoices" />
      <div className={cn("ml-56 flex-1 bg-slate-50")}>
        <div className={cn("px-6 py-8")}>
          <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold print:hidden")}>
            New invoice
          </h1>
          <Suspense>
            <InvoiceBuilderView token={t} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
