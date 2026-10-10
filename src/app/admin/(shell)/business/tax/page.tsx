// src/app/admin/(shell)/business/tax/page.tsx
// Tax page for one NZ financial year, picked by `?fy=` (defaults to the current FY). The
// server loads the year's ledger, assets, trips and TaxYear record, runs computeTaxYear,
// and renders the summary strip, then deductions, income tax workings and the home office
// and car form beside the set-aside targets, the filed status and the questions to raise
// with the accountant, then the accountant summary with CSV export. A filed year renders
// its saved snapshot, with a Filed pill, the differences a fresh calculation shows and a
// locked home office and car form.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminTabs } from "@/features/admin/components/ui/AdminTabs";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { AccountantNotes } from "@/features/business/components/tax/AccountantNotes";
import { AccountantSummary } from "@/features/business/components/tax/AccountantSummary";
import { DeductionsBreakdown } from "@/features/business/components/tax/DeductionsBreakdown";
import { FiledChangesNotice } from "@/features/business/components/tax/FiledChangesNotice";
import { FiledYearControls } from "@/features/business/components/tax/FiledYearControls";
import { HomeOfficeForm } from "@/features/business/components/tax/HomeOfficeForm";
import { IncomeTaxWorkings } from "@/features/business/components/tax/IncomeTaxWorkings";
import {
  SetAsideCard,
  TaxEstimateCards,
} from "@/features/business/components/tax/TaxEstimateCards";
import { formatNZD } from "@/features/business/lib/business";
import { fyKeyOf, type FinancialYear } from "@/features/business/lib/financial-year";
import { irdRatesFor, setAsideTargets } from "@/features/business/lib/tax";
import { kmRatesFor, loadAllFys } from "@/features/business/lib/tax/load";
import { loadTaxYearView } from "@/features/business/lib/tax/view.server";
import { fuelLabel } from "@/features/business/lib/tax/workings";
import { pickFy } from "@/features/business/lib/trips";
import { Notice } from "@/shared/components/Notice";
import { requireAdminAuth } from "@/shared/lib/auth";
import { nzDayStartUtc } from "@/shared/lib/timezone-utils";
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
 * Tax page. An unfiled year is computed live from the ledger, the asset register, the trip
 * log, the FY's TaxYear record and the tax settings; a filed year shows its saved snapshot.
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
  const selected = pickFy(fys, fyParam) ?? pickFy(fys, undefined);

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
  // While the year is filed every figure on the page comes from the saved snapshot; the
  // live recompute only feeds the list of differences. `record` still feeds the home office
  // form, whose fields the PUT refuses to change while filed.
  const view = await loadTaxYearView(selected, now);
  const { input, record } = view;
  const result = view.shown.result;
  const filed = view.filedAtIso !== null;
  // The threshold in Settings may have moved since the year was filed, so a filed year
  // names it without the live figure.
  const provisionalOver = filed
    ? "the provisional tax threshold"
    : formatNZD(input.settings.provisionalThreshold);
  // Nothing records what has already been put aside, so the whole total is "remaining".
  const targets = setAsideTargets(result.totalToSetAside, input.fy, now);
  const irdDefaults = irdRatesFor(fyKey);
  const kmDefaults = kmRatesFor(irdDefaults, input.settings.vehicleFuel);

  return (
    <>
      {header}
      <FyTabs fys={fys} active={fyKey} />

      {filed && (
        <FiledChangesNotice
          fyLabel={selected.label}
          changes={view.changes}
          unreadable={view.snapshotUnreadable}
        />
      )}

      {result.provisionalWarning && (
        <Notice tone="warn" onGrey className="mb-6">
          Income tax for this year is over {provisionalOver}, so IRD will expect provisional tax for
          next year. Ask your accountant which option suits you and when the payments are due.
        </Notice>
      )}

      <TaxEstimateCards result={result} fyLabel={selected.label} />

      {/* Phone: the set-aside card straight after the strip, as it answers the question
          most visits are for. Desktop shows the same card at the top of the side column. */}
      <SetAsideCard
        result={result}
        targets={targets}
        current={input.fy.current}
        fyLabel={selected.label}
        className="mb-6 lg:hidden"
      />

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-8">
          <DeductionsBreakdown result={result} gst={input.gst} filed={filed} />
          <IncomeTaxWorkings
            result={result}
            settings={input.settings}
            accRate={input.year.accRate ?? input.settings.acc}
            filed={filed}
          />
          <HomeOfficeForm
            // Remount per FY so a half-typed draft never carries into another year.
            key={fyKey}
            fyKey={fyKey}
            fyLabel={selected.label}
            filed={filed}
            initial={{
              officeSqm: record?.officeSqm ?? null,
              houseSqm: record?.houseSqm ?? null,
              sqmRate: record?.sqmRate ?? null,
              kmTier1: record?.kmTier1 ?? null,
              kmTier2: record?.kmTier2 ?? null,
              totalVehicleKm: record?.totalVehicleKm ?? null,
              accRate: record?.accRate ?? null,
              mortgageInterestOrRent: record?.mortgageInterestOrRent ?? null,
              rates: record?.rates ?? null,
            }}
            defaults={{
              sqmRate: irdDefaults.sqmRate,
              kmTier1: kmDefaults.tier1,
              kmTier2: kmDefaults.tier2,
              accRate: input.settings.acc,
            }}
            fuel={fuelLabel(input.settings.vehicleFuel)}
            claim={result.homeOffice}
            businessKm={result.km.businessKm}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-4">
          <SetAsideCard
            result={result}
            targets={targets}
            current={input.fy.current}
            fyLabel={selected.label}
            className="max-lg:hidden"
          />
          <Card>
            <CardHeader title="Filing" />
            <FiledYearControls
              fyKey={fyKey}
              fyLabel={selected.label}
              filedAtIso={view.filedAtIso}
              canFile={selected.end <= nzDayStartUtc(now)}
            />
          </Card>
          <AccountantNotes />
        </div>
      </div>

      <AccountantSummary
        view={view.shown}
        fyKey={fyKey}
        fyLabel={selected.label}
        unreadable={view.snapshotUnreadable}
      />
    </>
  );
}
