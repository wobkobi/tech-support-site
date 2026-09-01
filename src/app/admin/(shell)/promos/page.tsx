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
