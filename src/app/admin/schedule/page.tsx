// src/app/admin/schedule/page.tsx
import type { Metadata } from "next";
import type React from "react";
import { prisma } from "@/shared/lib/prisma";
import { requireAdminToken } from "@/shared/lib/auth";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { fetchAllCalendarEvents } from "@/features/calendar/lib/google-calendar";
import { addDays, resolveWeekStart, toNZDateKey } from "@/features/admin/lib/week";
import { WeekView, type WeekEvent, type WeekViewKind } from "@/features/admin/components/WeekView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Schedule - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin week schedule page. Renders a 7-day grid showing booking, work, personal,
 * and travel events for the requested week. Empty slots are clickable to create a
 * manual booking from the modal.
 * @param root0 - Page props.
 * @param root0.searchParams - URL params with token and optional weekStart=YYYY-MM-DD.
 * @returns Schedule page element.
 */
export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; weekStart?: string }>;
}): Promise<React.ReactElement> {
  const { token, weekStart } = await searchParams;
  const t = requireAdminToken(token);

  const now = new Date();
  const weekStartDate = resolveWeekStart(weekStart, now);
  const weekEndDate = addDays(weekStartDate, 7);

  const bookingCalId = process.env.BOOKING_CALENDAR_ID ?? "";
  const workCalId = process.env.WORK_CALENDAR_ID ?? "";
  const personalCalId = process.env.PERSONAL_CALENDAR_ID ?? "";

  // Live calendar fetch covers all configured calendars for the week range.
  // Travel blocks queried separately because synthetic cache entries don't
  // carry their parent context.
  const [rawEvents, travelBlocks] = await Promise.all([
    fetchAllCalendarEvents(weekStartDate, weekEndDate).catch(() => []),
    prisma.travelBlock.findMany({
      where: {
        eventStartAt: { lt: weekEndDate },
        eventEndAt: { gte: weekStartDate },
      },
      select: {
        id: true,
        sourceEventId: true,
        summary: true,
        eventStartAt: true,
        eventEndAt: true,
        roundedMinutes: true,
        roundedBackMinutes: true,
        beforeEventId: true,
        afterEventId: true,
        travelBackSuppressed: true,
        detectedOrigin: true,
        destination: true,
        customTravelBackDestination: true,
      },
    }),
  ]);

  /**
   * Classifies a calendar event by which configured calendar it came from.
   * @param calendarEmail - Calendar source ID for the event.
   * @returns Kind tag used for colour-coding in the grid.
   */
  function kindForCalendar(calendarEmail: string): WeekViewKind {
    if (calendarEmail === bookingCalId) return "booking";
    if (calendarEmail === workCalId) return "work";
    if (calendarEmail === personalCalId) return "personal";
    return "personal";
  }

  const events: WeekEvent[] = [];

  for (const e of rawEvents) {
    const durationMs = new Date(e.end).getTime() - new Date(e.start).getTime();
    events.push({
      id: e.id,
      kind: kindForCalendar(e.calendarEmail),
      title: e.summary ?? "(no title)",
      startAt: e.start,
      endAt: e.end,
      location: e.location ?? null,
      // fetchAllCalendarEvents converts all-day Google events to 24h timed events
      // spanning NZ midnight > midnight; treat anything >= 23h as a banner item.
      isAllDay: durationMs >= 23 * 60 * 60 * 1000,
    });
  }

  for (const b of travelBlocks) {
    if (b.beforeEventId && b.roundedMinutes != null) {
      const start = new Date(b.eventStartAt.getTime() - b.roundedMinutes * 60_000);
      events.push({
        id: b.beforeEventId,
        kind: "travel",
        title: `→ ${b.summary ?? "Travel"}`,
        startAt: start.toISOString(),
        endAt: b.eventStartAt.toISOString(),
        location: b.detectedOrigin ?? null,
        isAllDay: false,
      });
    }
    if (b.afterEventId && b.roundedBackMinutes != null && !b.travelBackSuppressed) {
      const end = new Date(b.eventEndAt.getTime() + b.roundedBackMinutes * 60_000);
      events.push({
        id: b.afterEventId,
        kind: "travel",
        title: `← ${b.customTravelBackDestination ?? "home"}`,
        startAt: b.eventEndAt.toISOString(),
        endAt: end.toISOString(),
        location: b.customTravelBackDestination ?? null,
        isAllDay: false,
      });
    }
  }

  const prevWeekKey = toNZDateKey(addDays(weekStartDate, -7));
  const nextWeekKey = toNZDateKey(addDays(weekStartDate, 7));

  return (
    <AdminPageLayout token={t} current="schedule">
      <WeekView
        token={t}
        weekStartIso={weekStartDate.toISOString()}
        prevWeekKey={prevWeekKey}
        nextWeekKey={nextWeekKey}
        events={events}
      />
    </AdminPageLayout>
  );
}
