import type { Metadata } from "next";
import type React from "react";
import { notFound } from "next/navigation";
import { isValidAdminToken } from "@/shared/lib/auth";
import { AdminSidebar } from "@/features/admin/components/AdminSidebar";
import { IncomeView } from "@/features/business/components/IncomeView";
import { cn } from "@/shared/lib/cn";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Income - Business",
  robots: { index: false, follow: false },
};

/**
 * Admin income page for recording and viewing income entries.
 * @param root0 - Page props
 * @param root0.searchParams - URL search parameters containing the admin token
 * @returns Income page element
 */
export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await searchParams;
  if (!isValidAdminToken(token ?? null)) notFound();
  const t = token!;

  return (
    <div className={cn("flex min-h-screen")}>
      <AdminSidebar token={t} current="business-income" />
      <div className={cn("ml-56 flex-1 bg-slate-50")}>
        <div className={cn("px-6 py-8")}>
          <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>Income</h1>
          <IncomeView token={t} />
        </div>
      </div>
    </div>
  );
}
