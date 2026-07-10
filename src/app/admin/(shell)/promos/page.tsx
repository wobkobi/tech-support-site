// src/app/admin/(shell)/promos/page.tsx
/**
 * @description Admin promos page. Loads all promos, maps them to
 * {@link PromoRow}s for the server > client boundary, and renders
 * {@link PromosView} for inline CRUD of time-limited pricing offers.
 */
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
  flatHourlyRate: number | null;
  percentDiscount: number | null;
  isActive: boolean;
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
    flatHourlyRate: p.flatHourlyRate,
    percentDiscount: p.percentDiscount,
    isActive: p.isActive,
  }));

  return (
    <>
      <h1 className="mb-6 text-2xl font-extrabold text-russian-violet">Promos</h1>
      <p className="mb-6 text-sm text-slate-500">
        Time-limited offers. Each active promo applies automatically to the public pricing wizard,
        the admin calculator, and the site-wide banner. Only one promo is active at a time; if date
        ranges overlap the most recently created one wins.
      </p>
      <PromosView initial={initial} />
    </>
  );
}
