import type { Metadata } from "next";
import type React from "react";
import { requireAdminAuth } from "@/shared/lib/auth";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { IncomeView } from "@/features/business/components/IncomeView";
import { cn } from "@/shared/lib/cn";

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
      <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>Income</h1>
      <IncomeView />
    </AdminPageLayout>
  );
}
