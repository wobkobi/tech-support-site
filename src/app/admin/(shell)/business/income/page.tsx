// src/app/admin/(shell)/business/income/page.tsx
/**
 * @description Admin income page. Renders {@link IncomeView} for recording and
 * viewing income entries.
 */
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { IncomeView } from "@/features/business/components/IncomeView";
import { requireAdminAuth } from "@/shared/lib/auth";
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
    <>
      <PageHeader
        title="Income"
        description="Record income entries; each syncs to the Cashbook sheet. Invoice payments appear here automatically."
      />
      <IncomeView />
    </>
  );
}
