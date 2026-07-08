// src/app/admin/business/calculator/page.tsx
/**
 * @description Job calculator page. Resolves business identity, pricing
 * policy, rate configs, task templates, and the active promo server-side in
 * one parallel pass, then hands them to {@link CalculatorView} for AI job
 * parsing and time-tracked quoting - only the slow Google Contacts picker
 * list is left to a client fetch.
 */
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { CalculatorView } from "@/features/business/components/CalculatorView";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { getActivePromo } from "@/features/business/lib/promos";
import type { RateConfig, TaskTemplate } from "@/features/business/types/business";
import { requireAdminAuth } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import type React from "react";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Calculator - Business",
  robots: { index: false, follow: false },
};

/**
 * Job calculator page with AI parsing, time tracking, and rate management.
 * @returns Calculator page element
 */
export default async function CalculatorPage(): Promise<React.ReactElement> {
  await requireAdminAuth();
  const [identity, policy, rateRows, templateRows, promo] = await Promise.all([
    getIdentity(),
    getPolicy(),
    // Full rows (ids included) - the calculator's rate panel edits by id, so
    // the trimmed public cache from getRateRows is not enough here.
    prisma.rateConfig.findMany({ orderBy: { label: "asc" } }),
    prisma.taskTemplate.findMany({ orderBy: [{ usageCount: "desc" }, { description: "asc" }] }),
    getActivePromo(),
  ]);
  const pricing = {
    gstRegistered: policy.GST_REGISTERED,
    minTravelCharge: policy.MIN_TRAVEL_CHARGE,
    billingIncrementMins: policy.BILLING_INCREMENT_MINS,
    minBillableMins: policy.MIN_BILLABLE_MINS,
  };

  // Flatten Dates to the ISO strings the client types expect (matches what
  // the JSON API routes previously returned).
  const initialRates: RateConfig[] = rateRows.map((r) => ({
    id: r.id,
    label: r.label,
    ratePerHour: r.ratePerHour,
    flatRate: r.flatRate,
    hourlyDelta: r.hourlyDelta,
    percentDelta: r.percentDelta,
    unit: r.unit,
    isDefault: r.isDefault,
    createdAt: r.createdAt.toISOString(),
  }));
  const initialTaskTemplates: TaskTemplate[] = templateRows.map((t) => ({
    id: t.id,
    description: t.description,
    defaultPrice: t.defaultPrice,
    usageCount: t.usageCount,
    device: t.device,
    action: t.action,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));

  return (
    <AdminPageLayout current="business-calculator">
      <h1 className="mb-6 text-2xl font-extrabold text-russian-violet">Job calculator</h1>
      <Suspense>
        <CalculatorView
          identity={identity}
          pricing={pricing}
          initialRates={initialRates}
          initialTaskTemplates={initialTaskTemplates}
          initialPromo={promo}
        />
      </Suspense>
    </AdminPageLayout>
  );
}
