import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { IncomeView } from "@/features/business/components/IncomeView";
import { requireAdminAuth } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/cn";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Income - Business",
  robots: { index: false, follow: false },
};

/**
 * Admin income page for recording and viewing income entries.
 * @returns Income page element
 */
export default async function IncomePage(): Promise<React.ReactElement> {
  await requireAdminAuth();

  return (
    <AdminPageLayout current="business-income">
      <h1 className={cn("mb-6 text-2xl font-extrabold text-russian-violet")}>Income</h1>
      <IncomeView />
    </AdminPageLayout>
  );
}
