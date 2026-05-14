// src/app/admin/promos/page.tsx
import type { Metadata } from "next";
import type React from "react";
import { requireAdminToken } from "@/shared/lib/auth";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { cn } from "@/shared/lib/cn";
import { prisma } from "@/shared/lib/prisma";
import { PromosView } from "@/features/business/components/PromosView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Promos - Admin",
  robots: { index: false, follow: false },
};

/** Plain-data shape passed across the server -> client boundary. */
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
 * @param root0 - Page props.
 * @param root0.searchParams - URL search params (contains token).
 * @returns Promos page element.
 */
export default async function AdminPromosPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await searchParams;
  const t = requireAdminToken(token);

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
    <AdminPageLayout token={t} current="promos">
      <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>Promos</h1>
      <p className={cn("mb-6 text-sm text-slate-500")}>
        Time-limited offers. Each active promo applies automatically to the public pricing wizard,
        the admin calculator, and the site-wide banner. Only one promo is active at a time; if date
        ranges overlap the most recently created one wins.
      </p>
      <PromosView token={t} initial={initial} />
    </AdminPageLayout>
  );
}
