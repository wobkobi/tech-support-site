// src/app/admin/travel/page.tsx
import type { Metadata } from "next";
import type React from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/shared/lib/prisma";
import { isValidAdminToken } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/cn";
import { AdminSidebar } from "@/features/admin/components/AdminSidebar";
import {
  TravelBlockAdminList,
  type TravelBlockRow,
} from "@/features/admin/components/TravelBlockAdminList";
import { RecalculateButton } from "@/features/admin/components/RecalculateButton";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Travel - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin travel blocks page showing computed travel time blocks and recalculate action.
 * @param root0 - Page props.
 * @param root0.searchParams - URL search parameters (contains token).
 * @returns Travel blocks page element.
 */
export default async function AdminTravelPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await searchParams;

  if (!isValidAdminToken(token ?? null)) {
    console.warn("[admin/travel] Invalid token attempt", { tokenPresent: Boolean(token) });
    notFound();
  }

  const t = token!;

  const travelBlocks = await prisma.travelBlock.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      sourceEventId: true,
      calendarEmail: true,
      summary: true,
      eventStartAt: true,
      eventEndAt: true,
      rawTravelMinutes: true,
      roundedMinutes: true,
      rawTravelBackMinutes: true,
      roundedBackMinutes: true,
      beforeEventId: true,
      afterEventId: true,
      transportMode: true,
      customOrigin: true,
      detectedOrigin: true,
      createdAt: true,
    },
  });

  const syntheticIds = travelBlocks
    .flatMap((b) => [b.beforeEventId, b.afterEventId])
    .filter((id): id is string => id !== null);

  const travelCacheEntries =
    syntheticIds.length > 0
      ? await prisma.calendarEventCache.findMany({
          where: { eventId: { in: syntheticIds } },
          select: { eventId: true, expiresAt: true },
        })
      : [];

  const travelCacheMap = new Map(travelCacheEntries.map((e) => [e.eventId, e.expiresAt]));

  const travelBlockRows: TravelBlockRow[] = travelBlocks.map((b) => ({
    id: b.id,
    sourceEventId: b.sourceEventId,
    calendarEmail: b.calendarEmail,
    summary: b.summary ?? null,
    eventStartAt: b.eventStartAt.toISOString(),
    eventEndAt: b.eventEndAt.toISOString(),
    rawTravelMinutes: b.rawTravelMinutes ?? null,
    roundedMinutes: b.roundedMinutes ?? null,
    rawTravelBackMinutes: b.rawTravelBackMinutes ?? null,
    roundedBackMinutes: b.roundedBackMinutes ?? null,
    beforeEventId: b.beforeEventId ?? null,
    afterEventId: b.afterEventId ?? null,
    transportMode: b.transportMode ?? null,
    customOrigin: b.customOrigin ?? null,
    detectedOrigin: b.detectedOrigin ?? null,
    beforeExpiresAt: b.beforeEventId
      ? (travelCacheMap.get(b.beforeEventId)?.toISOString() ?? null)
      : null,
    afterExpiresAt: b.afterEventId
      ? (travelCacheMap.get(b.afterEventId)?.toISOString() ?? null)
      : null,
    createdAt: b.createdAt.toISOString(),
  }));

  // Friendly display names for calendar IDs
  const calendarLabels: Record<string, string> = {};
  if (process.env.BOOKING_CALENDAR_ID) calendarLabels[process.env.BOOKING_CALENDAR_ID] = "Bookings";
  if (process.env.WORK_CALENDAR_ID) calendarLabels[process.env.WORK_CALENDAR_ID] = "Work";
  if (process.env.PERSONAL_CALENDAR_ID)
    calendarLabels[process.env.PERSONAL_CALENDAR_ID] = "Personal";

  return (
    <div className={cn("flex min-h-screen")}>
      <AdminSidebar token={t} current="travel" />

      <div className={cn("ml-56 flex-1 bg-slate-50")}>
        <div className={cn("mx-auto max-w-7xl px-6 py-8")}>
          <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>Travel blocks</h1>

          <div className={cn("rounded-xl border border-slate-200 bg-white p-6 shadow-sm")}>
            <div className={cn("mb-5 flex flex-wrap items-center justify-between gap-4")}>
              <p className={cn("text-sm text-slate-500")}>
                Travel time blocks computed for calendar events with a location. Refreshed every 15
                minutes by the cron job.
              </p>
              <RecalculateButton token={t} />
            </div>
            <TravelBlockAdminList
              blocks={travelBlockRows}
              calendarLabels={calendarLabels}
              token={t}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
