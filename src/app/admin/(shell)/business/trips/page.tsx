// src/app/admin/(shell)/business/trips/page.tsx
// Business trips page: the FY's km log, jobs that still need a trip, and the IRD
// kilometre-rate claim (tier 1 for the business share of the car's first 14,000 km, tier
// 2 after). FY tabs drive it through ?fy=, defaulting to the current year; the rates, the
// car's total km and the km-rate vehicle periods come from the FY's tax inputs, the same
// source the Tax page uses.

import { AdminTabs } from "@/features/admin/components/ui/AdminTabs";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { TripsView } from "@/features/business/components/trips/TripsView";
import { fyKeyOf } from "@/features/business/lib/financial-year";
import { loadAllFys, loadTaxInputs } from "@/features/business/lib/tax/load";
import { kmVehiclePeriods } from "@/features/business/lib/tax/vehicle";
import { pickFy } from "@/features/business/lib/trips";
import { loadTripSuggestions, loadTrips } from "@/features/business/lib/trips.server";
import { Notice } from "@/shared/components/Notice";
import { requireAdminAuth } from "@/shared/lib/auth";
import { VEHICLE_FUEL_LABELS } from "@/shared/lib/settings/field-meta";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Trips - Business",
  robots: { index: false, follow: false },
};

/**
 * Trips page for one financial year.
 * @param root0 - Page props.
 * @param root0.searchParams - URL search params (`?fy=` FY key).
 * @returns Trips page element.
 */
export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth("/admin/business/trips");
  const { fy: fyParam } = await searchParams;
  const now = new Date();

  // Newest first for the tabs, whatever order the loader returns.
  const fys = [...(await loadAllFys(now))].sort((a, b) => b.start.getTime() - a.start.getTime());
  // An unknown ?fy= falls back to the current year, as on the business page.
  const fy = pickFy(fys, fyParam) ?? pickFy(fys, undefined);
  if (!fy) {
    return (
      <>
        <PageHeader title="Trips" />
        <Notice onGrey>No financial years yet. Check the business start date in Settings.</Notice>
      </>
    );
  }
  const fyKey = fyKeyOf(fy.label);

  const [trips, suggestions, taxInputs] = await Promise.all([
    loadTrips({ start: fy.start, end: fy.end }),
    loadTripSuggestions(fy, now),
    loadTaxInputs(fy, now),
  ]);

  return (
    <>
      <PageHeader
        title="Trips"
        description="Business km for the IRD kilometre rate. Log one round trip per job."
      />

      {/* FY selector: links, so `?fy=` stays the source of truth. */}
      <AdminTabs
        aria-label="Financial year"
        active={fyKey}
        className="mb-6"
        tabs={fys.map((f) => {
          const key = fyKeyOf(f.label);
          return {
            key,
            label: f.label,
            href: `/admin/business/trips?fy=${encodeURIComponent(key)}`,
            badge:
              f.current && key !== fyKey ? (
                <span className="rounded-full bg-moonstone-400/15 px-2 py-0.5 text-sm font-bold text-moonstone-700">
                  Current
                </span>
              ) : undefined,
          };
        })}
      />

      <TripsView
        // Remount per FY so the lists and drafts start from that year's data.
        key={fyKey}
        fyKey={fyKey}
        fyLabel={fy.label}
        startISO={fy.start.toISOString()}
        endISO={fy.end.toISOString()}
        initialTrips={trips}
        initialSuggestions={suggestions}
        rates={{ tier1: taxInputs.year.kmTier1, tier2: taxInputs.year.kmTier2 }}
        totalVehicleKm={taxInputs.year.totalVehicleKm ?? null}
        kmPeriods={kmVehiclePeriods(taxInputs.assets)}
        fuelLabel={VEHICLE_FUEL_LABELS[taxInputs.settings.vehicleFuel]}
      />
    </>
  );
}
