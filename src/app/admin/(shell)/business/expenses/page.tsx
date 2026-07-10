// src/app/admin/(shell)/business/expenses/page.tsx
/**
 * @description Admin expenses page. Renders {@link ExpensesView} for recording
 * and viewing expense entries, with {@link SubscriptionsView} below for
 * recurring subscription costs.
 */
import { ExpensesView } from "@/features/business/components/ExpensesView";
import { SubscriptionsView } from "@/features/business/components/SubscriptionsView";
import { requireAdminAuth } from "@/shared/lib/auth";
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
    <>
      <h1 className="mb-6 text-2xl font-extrabold text-russian-violet">Expenses</h1>
      <ExpensesView />
      <div className="mt-10">
        <SubscriptionsView />
      </div>
    </>
  );
}
