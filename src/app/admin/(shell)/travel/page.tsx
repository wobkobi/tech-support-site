// src/app/admin/(shell)/travel/page.tsx
// Admin travel blocks page: computed blocks with their cache expiry, plus a recalculate button.

import { RecalculateButton } from "@/features/admin/components/RecalculateButton";
import {
  TravelBlockAdminList,
  type TravelBlockRow,
} from "@/features/admin/components/TravelBlockAdminList";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Travel - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin travel blocks page showing computed travel time blocks and recalculate action.
 * @returns Travel blocks page element.
 */
export default async function AdminTravelPage(): Promise<React.ReactElement> {
  await requireAdminAuth();

  const workCalId = process.env.WORK_CALENDAR_ID ?? process.env.CAR_CALENDAR_ID;

  const travelBlocks = await prisma.travelBlock.findMany({
    orderBy: { eventStartAt: "asc" },
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
      destination: true,
      travelBackSuppressed: true,
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
    destination: b.destination ?? null,
    beforeExpiresAt: b.beforeEventId
      ? (travelCacheMap.get(b.beforeEventId)?.toISOString() ?? null)
      : null,
    afterExpiresAt: b.afterEventId
      ? (travelCacheMap.get(b.afterEventId)?.toISOString() ?? null)
      : null,
    travelBackSuppressed: b.travelBackSuppressed,
    createdAt: b.createdAt.toISOString(),
  }));

  const calendarLabels: Record<string, string> = {};
  if (process.env.BOOKING_CALENDAR_ID) calendarLabels[process.env.BOOKING_CALENDAR_ID] = "Bookings";
  if (workCalId) calendarLabels[workCalId] = "Work";
  if (process.env.PERSONAL_CALENDAR_ID)
    calendarLabels[process.env.PERSONAL_CALENDAR_ID] = "Personal";

  return (
    <>
      <PageHeader
        title="Travel blocks"
        description="Travel time blocks computed for calendar events with a location. Refreshed every 30 minutes by the cron job."
        actions={<RecalculateButton />}
      />

      <TravelBlockAdminList blocks={travelBlockRows} calendarLabels={calendarLabels} />
    </>
  );
}
