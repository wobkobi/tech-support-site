import type { Metadata } from "next";
import type React from "react";
import { Suspense } from "react";
import { requireAdminToken } from "@/shared/lib/auth";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { CalculatorView } from "@/features/business/components/CalculatorView";
import { cn } from "@/shared/lib/cn";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Calculator - Business",
  robots: { index: false, follow: false },
};

/**
 * Job calculator page with AI parsing, time tracking, and rate management.
 * @param root0 - Page props
 * @param root0.searchParams - URL search parameters containing the admin token
 * @returns Calculator page element
 */
export default async function CalculatorPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await searchParams;
  const t = requireAdminToken(token);

  return (
    <AdminPageLayout token={t} current="business-calculator">
      <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>Job calculator</h1>
      <Suspense>
        <CalculatorView token={t} />
      </Suspense>
    </AdminPageLayout>
  );
}
