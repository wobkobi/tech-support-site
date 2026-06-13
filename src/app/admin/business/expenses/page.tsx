import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { ExpensesView } from "@/features/business/components/ExpensesView";
import { SubscriptionsView } from "@/features/business/components/SubscriptionsView";
import { requireAdminAuth } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/cn";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Expenses - Business",
  robots: { index: false, follow: false },
};

/**
 * Admin expenses page for recording and viewing expense entries.
 * @returns Expenses page element
 */
export default async function ExpensesPage(): Promise<React.ReactElement> {
  await requireAdminAuth();

  return (
    <AdminPageLayout current="business-expenses">
      <h1 className={cn("mb-6 text-2xl font-extrabold text-russian-violet")}>Expenses</h1>
      <ExpensesView />
      <div className="mt-10">
        <SubscriptionsView />
      </div>
    </AdminPageLayout>
  );
}
