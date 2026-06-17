import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { CalculatorView } from "@/features/business/components/CalculatorView";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { requireAdminAuth } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
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
  const identity = await getIdentity();
  const policy = await getPolicy();
  const pricing = {
    gstRegistered: policy.GST_REGISTERED,
    minTravelCharge: policy.MIN_TRAVEL_CHARGE,
    billingIncrementMins: policy.BILLING_INCREMENT_MINS,
  };

  return (
    <AdminPageLayout current="business-calculator">
      <h1 className="mb-6 text-2xl font-extrabold text-russian-violet">Job calculator</h1>
      <Suspense>
        <CalculatorView identity={identity} pricing={pricing} />
      </Suspense>
    </AdminPageLayout>
  );
}
