// src/app/admin/(shell)/promos/page.tsx
/**
 * @description Admin promos page. Loads all promos, maps them to
 * {@link PromoRow}s for the server > client boundary, and renders
 * {@link PromosView} for inline CRUD of time-limited pricing offers.
 */
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { PromosView } from "@/features/business/components/PromosView";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Promos - Admin",
  robots: { index: false, follow: false },
};

/** Plain-data shape passed across the server > client boundary. */
export interface PromoRow {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  discountType: "flat_hourly" | "percent" | "fixed_amount" | "free_travel" | null;
  /** Automatic promos apply to everyone; a code promo only to whoever enters it. */
  kind: "automatic" | "code";
  /** Uppercase code for a code promo, null for an automatic one. */
  code: string | null;
  flatHourlyRate: number | null;
  percentDiscount: number | null;
  fixedAmount: number | null;
  /** Fraction of travel still charged; 0 is free travel. */
  travelPercent: number | null;
  isActive: boolean;
  /** Higher wins when windows overlap. */
  priority: number;
  /** Total uses allowed across everyone, or null for no cap. */
  maxRedemptions: number | null;
  /** Uses allowed per customer, or null for no cap. */
  perCustomerLimit: number | null;
  /** Restricted to someone with no prior completed booking. */
  newCustomersOnly: boolean;
  /** Floor for the pre-discount total, or null for none. */
  minSpend: number | null;
  /** Spend bands; when non-empty they supply the discount instead of the columns above. */
  tiers: {
    minSpend: number;
    flatHourlyRate: number | null;
    percentDiscount: number | null;
    fixedAmount: number | null;
    travelPercent: number | null;
  }[];
  /** NZ weekdays it applies on (0 = Sunday); empty means every day. */
  activeWeekdays: number[];
  /** Start of the NZ time-of-day restriction, in minutes past midnight. */
  activeFromMinute: number | null;
  /** End of the NZ time-of-day restriction, in minutes past midnight. */
  activeToMinute: number | null;
  /** The overlap warning's tie-break must match the query's, so it needs this. */
  createdAt: string;
}

/**
 * Admin Promos page - lists promos with inline CRUD via PromosView.
 * @returns Promos page element.
 */
export default async function AdminPromosPage(): Promise<React.ReactElement> {
  await requireAdminAuth();

  const promos = await prisma.promo.findMany({ orderBy: { startAt: "desc" } });
  const initial: PromoRow[] = promos.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    startAt: p.startAt.toISOString(),
    endAt: p.endAt.toISOString(),
    discountType: p.discountType,
    kind: p.kind,
    code: p.code,
    flatHourlyRate: p.flatHourlyRate,
    percentDiscount: p.percentDiscount,
    fixedAmount: p.fixedAmount,
    travelPercent: p.travelPercent,
    isActive: p.isActive,
    priority: p.priority,
    maxRedemptions: p.maxRedemptions,
    perCustomerLimit: p.perCustomerLimit,
    newCustomersOnly: p.newCustomersOnly,
    minSpend: p.minSpend,
    tiers: p.tiers.map((t) => ({
      minSpend: t.minSpend,
      flatHourlyRate: t.flatHourlyRate,
      percentDiscount: t.percentDiscount,
      fixedAmount: t.fixedAmount,
      travelPercent: t.travelPercent,
    })),
    activeWeekdays: p.activeWeekdays,
    activeFromMinute: p.activeFromMinute,
    activeToMinute: p.activeToMinute,
    createdAt: p.createdAt.toISOString(),
  }));

  return (
    <>
      <PageHeader
        title="Promos"
        description="Time-limited offers. An automatic promo applies to every visitor and shows on the site-wide banner; a code promo applies only to someone who enters its code, and is never advertised. Only one applies at a time - a valid code beats an automatic promo, and where windows overlap the highest priority wins, then the most recently created."
      />
      <PromosView initial={initial} />
    </>
  );
}
