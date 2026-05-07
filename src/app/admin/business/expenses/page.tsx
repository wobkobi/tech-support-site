import type { Metadata } from "next";
import type React from "react";
import { requireAdminToken } from "@/shared/lib/auth";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { ExpensesView } from "@/features/business/components/ExpensesView";
import { SubscriptionsView } from "@/features/business/components/SubscriptionsView";
import { cn } from "@/shared/lib/cn";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Expenses - Business",
  robots: { index: false, follow: false },
};

/**
 * Admin expenses page for recording and viewing expense entries.
 * @param root0 - Page props
 * @param root0.searchParams - URL search parameters containing the admin token
 * @returns Expenses page element
 */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await searchParams;
  const t = requireAdminToken(token);

  return (
    <AdminPageLayout token={t} current="business-expenses">
      <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>Expenses</h1>
      <ExpensesView token={t} />
      <div className="mt-10">
        <SubscriptionsView token={t} />
      </div>
    </AdminPageLayout>
  );
}
