import type { Metadata } from "next";
import type React from "react";
import { requireAdminToken } from "@/shared/lib/auth";
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
  const t = requireAdminToken(token);

  return (
    <AdminPageLayout token={t} current="business-income">
      <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>Income</h1>
      <IncomeView token={t} />
    </AdminPageLayout>
  );
}
