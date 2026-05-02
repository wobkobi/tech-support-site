import type { Metadata } from "next";
import type React from "react";
import { notFound } from "next/navigation";
import { isValidAdminToken } from "@/shared/lib/auth";
import { AdminSidebar } from "@/features/admin/components/AdminSidebar";
import { ExpensesView } from "@/features/business/components/ExpensesView";
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
  if (!isValidAdminToken(token ?? null)) notFound();
  const t = token!;

  return (
    <div className={cn("flex min-h-screen")}>
      <AdminSidebar token={t} current="business-expenses" />
      <div className={cn("ml-56 flex-1 bg-slate-50")}>
        <div className={cn("px-6 py-8")}>
          <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>Expenses</h1>
          <ExpensesView token={t} />
        </div>
      </div>
    </div>
  );
}
