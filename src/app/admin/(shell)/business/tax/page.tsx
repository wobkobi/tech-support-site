// src/app/admin/(shell)/business/tax/page.tsx
// Tax page for one NZ financial year, picked by `?fy=` (defaults to the current FY). The
// server loads the year's ledger, assets, trips and TaxYear record, runs computeTaxYear,
// and renders the estimate, set-aside targets, deductions, income tax workings, the home
// office and car form and the questions to raise with the accountant.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminTabs } from "@/features/admin/components/ui/AdminTabs";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { AccountantNotes } from "@/features/business/components/tax/AccountantNotes";
import { DeductionsBreakdown } from "@/features/business/components/tax/DeductionsBreakdown";
import { HomeOfficeForm } from "@/features/business/components/tax/HomeOfficeForm";
import { IncomeTaxWorkings } from "@/features/business/components/tax/IncomeTaxWorkings";
import { TaxEstimateCards } from "@/features/business/components/tax/TaxEstimateCards";
import { formatNZD } from "@/features/business/lib/business";
import { fyKeyOf, type FinancialYear } from "@/features/business/lib/financial-year";
import { computeTaxYear, irdRatesFor, setAsideTargets } from "@/features/business/lib/tax";
import { loadAllFys, loadTaxInputs } from "@/features/business/lib/tax/load";
import { fuelLabel } from "@/features/business/lib/tax/workings";
import { Notice } from "@/shared/components/Notice";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tax - Business",
  robots: { index: false, follow: false },
};

/**
 * Builds the `?fy=` URL for a financial-year tab.
 * @param fyKey - FY key, e.g. "2026-27".
 * @returns Relative URL.
 */
function tabHref(fyKey: string): string {
  return `/admin/business/tax?fy=${encodeURIComponent(fyKey)}`;
}

/**
 * The FY tabs, most recent first, with a "Current" badge on the running FY when another
 * tab is open.
 * @param props - Component props.
 * @param props.fys - Every FY, most recent first.
 * @param props.active - Active tab key.
 * @returns The tab bar.
 */
function FyTabs(props: { fys: FinancialYear[]; active: string }): React.ReactElement {
  const { fys, active } = props;
  const tabs = fys.map((f) => {
    const key = fyKeyOf(f.label);
    return {
      key,
      label: f.label,
      href: tabHref(key),
      badge:
        f.current && key !== active ? (
          <span className="rounded-full bg-moonstone-400/15 px-2 py-0.5 text-sm font-bold text-moonstone-700">
            Current
          </span>
        ) : undefined,
    };
  });
  // FY selector: links, so `?fy=` stays the source of truth.
  return <AdminTabs aria-label="Financial year" active={active} className="mb-6" tabs={tabs} />;
}

/**
 * Tax page. Every figure is computed live from the ledger, the asset register, the trip
 * log, the FY's TaxYear record and the tax settings; nothing is cached.
 * @param root0 - Page props.
 * @param root0.searchParams - URL search params (`?fy=` FY key).
 * @returns Tax page element.
 */
export default async function TaxPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth("/admin/business/tax");
  const { fy: fyParam } = await searchParams;
  const now = new Date();

  // Most recent first, like the overview's tabs. An unknown or missing key falls back
  // to the current FY.
  const fys = [...(await loadAllFys(now))].sort((a, b) => b.start.getTime() - a.start.getTime());
  const selected =
    fys.find((f) => fyKeyOf(f.label) === fyParam) ?? fys.find((f) => f.current) ?? fys[0];

  const header = (
    <PageHeader
      title="Tax"
      description="What to set aside for income tax and ACC, what you can claim, and what to check with your accountant."
      actions={
        <>
          <AdminButton href="/admin/business/assets" variant="secondary">
            Assets
          </AdminButton>
          <AdminButton href="/admin/business/trips" variant="secondary">
            Trips
          </AdminButton>
        </>
      }
    />
  );

  if (!selected) {
    return (
      <>
        {header}
        <EmptyState
          title="No financial years yet"
          body="Set the business start date in Settings and the estimate shows here."
        />
      </>
    );
  }

  const fyKey = fyKeyOf(selected.label);
  const [input, record] = await Promise.all([
    loadTaxInputs(selected, now),
    prisma.taxYear.findUnique({ where: { fyKey } }),
  ]);
  const result = computeTaxYear(input);
  // Nothing records what has already been put aside, so the whole total is "remaining".
  const targets = setAsideTargets(result.totalToSetAside, input.fy, now);
  const irdDefaults = irdRatesFor(fyKey);
  const kmDefaults = irdDefaults.km[input.settings.vehicleFuel];

  return (
    <>
      {header}
      <FyTabs fys={fys} active={fyKey} />

      {result.provisionalWarning && (
        <Notice tone="warn" onGrey className="mb-6">
          Income tax for this year is over {formatNZD(input.settings.provisionalThreshold)}, so IRD
          will expect provisional tax for next year. Ask your accountant which option suits you and
          when the payments are due.
        </Notice>
      )}

      <TaxEstimateCards result={result} targets={targets} current={input.fy.current} />

      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DeductionsBreakdown result={result} gst={input.gst} />
        <IncomeTaxWorkings result={result} settings={input.settings} />
      </div>

      <HomeOfficeForm
        // Remount per FY so a half-typed draft never carries into another year.
        key={fyKey}
        fyKey={fyKey}
        fyLabel={selected.label}
        filed={record?.filedAt != null}
        initial={{
          officeSqm: record?.officeSqm ?? null,
          houseSqm: record?.houseSqm ?? null,
          sqmRate: record?.sqmRate ?? null,
          kmTier1: record?.kmTier1 ?? null,
          kmTier2: record?.kmTier2 ?? null,
          totalVehicleKm: record?.totalVehicleKm ?? null,
          mortgageInterestOrRent: record?.mortgageInterestOrRent ?? null,
          rates: record?.rates ?? null,
        }}
        defaults={{
          sqmRate: irdDefaults.sqmRate,
          kmTier1: kmDefaults.tier1,
          kmTier2: kmDefaults.tier2,
        }}
        fuel={fuelLabel(input.settings.vehicleFuel)}
        claim={result.homeOffice}
        businessKm={result.km.businessKm}
      />

      <AccountantNotes />
    </>
  );
}
