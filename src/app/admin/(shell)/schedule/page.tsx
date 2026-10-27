// src/app/admin/(shell)/schedule/page.tsx
// Admin schedule page: prefetches a buffer of weeks around `?day=` / `?weekStart=` so
// stepping stays client-side.

import { DayAgendaView } from "@/features/admin/components/DayAgendaView";
import { ScheduleAutoRefresh } from "@/features/admin/components/ScheduleAutoRefresh";
import { ScheduleFindTimes } from "@/features/admin/components/ScheduleFindTimes";
import { WeekView } from "@/features/admin/components/WeekView";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { scheduleEventsToken } from "@/features/admin/lib/schedule-token";
import { mondayOf, type WeekEvent, type WeekViewKind } from "@/features/admin/lib/schedule-types";
import { addDays, resolveWeekStart } from "@/features/admin/lib/week";
import { holidayTakenOn } from "@/features/business/lib/holiday-calendar";
import { lookupPublicHolidaysForKeys } from "@/features/business/lib/pricing-policy.server";
import { getCachedScheduleCalendar } from "@/features/calendar/lib/google-calendar";
import { Notice } from "@/shared/components/Notice";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { nzDateKey } from "@/shared/lib/timezone-utils";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Schedule - Admin",
  robots: { index: false, follow: false },
};

/**
 * Weeks to prefetch either side of the requested week.
 */
const BUFFER_WEEKS = 3;
const BUFFER_DAYS_BEFORE = BUFFER_WEEKS * 7;
const BUFFER_DAYS_AFTER = (BUFFER_WEEKS + 1) * 7;

/**
 * Admin week schedule page; empty slots create a manual booking.
 * @param root0 - Page props.
 * @param root0.searchParams - URL params: optional `?weekStart=YYYY-MM-DD` + `?day=YYYY-MM-DD`.
 * @returns Schedule page element.
 */
export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ weekStart?: string; day?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth("/admin/schedule");
  const { weekStart, day } = await searchParams;
  // Live past-edit lock window, matching the server's.
  const { scheduling } = await getSettings();
  const lockHours = scheduling.pastEditLockHours;

  const now = new Date();
  // Prefer ?day=, then ?weekStart=, then today's week.
  const resolvedWeekStartParam = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? mondayOf(day) : weekStart;
  const weekStartDate = resolveWeekStart(resolvedWeekStartParam, now);
  // Prefetch BUFFER_WEEKS either side.
  const bufferStartDate = addDays(weekStartDate, -BUFFER_DAYS_BEFORE);
  const bufferEndDate = addDays(weekStartDate, BUFFER_DAYS_AFTER);
  // The fetch and the poll must share identical bounds (same cache key), or it refreshes every tick.
  const bufferStartIso = bufferStartDate.toISOString();
  const bufferEndIso = bufferEndDate.toISOString();

  const bookingCalId = process.env.BOOKING_CALENDAR_ID ?? "";
  const workCalId = process.env.WORK_CALENDAR_ID ?? process.env.CAR_CALENDAR_ID ?? "";
  const personalCalId = process.env.PERSONAL_CALENDAR_ID ?? "";

  // All calendars across the buffer; travel blocks are queried separately. A calendar that
  // didn't answer shows as free time, so the page says so instead of looking clear.
  const [{ events: rawEvents, unread }, travelBlocks] = await Promise.all([
    getCachedScheduleCalendar(bufferStartIso, bufferEndIso)
      .then((r) => ({
        events: r.events,
        unread: r.failedCalendarIds.length > 0 ? ("some" as const) : null,
      }))
      .catch((err: unknown) => {
        console.error("[admin/schedule] Couldn't read any calendar:", err);
        return { events: [], unread: "all" as const };
      }),
    prisma.travelBlock.findMany({
      where: {
        eventStartAt: { lt: bufferEndDate },
        eventEndAt: { gte: bufferStartDate },
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

  // Join booking-calendar events to their Booking row for the agenda card.
  const bookingCalEventIds = rawEvents
    .filter((e) => e.calendarEmail === bookingCalId)
    .map((e) => e.id);
  const bookings =
    bookingCalEventIds.length > 0
      ? await prisma.booking.findMany({
          where: { calendarEventId: { in: bookingCalEventIds } },
          select: {
            id: true,
            calendarEventId: true,
            cancelToken: true,
            name: true,
            email: true,
            phone: true,
            address: true,
            notes: true,
            status: true,
          },
        })
      : [];
  const bookingByCalId = new Map(bookings.map((b) => [b.calendarEventId, b]));

  const events: WeekEvent[] = [];

  for (const e of rawEvents) {
    const durationMs = new Date(e.end).getTime() - new Date(e.start).getTime();
    const kind = kindForCalendar(e.calendarEmail);
    const matchedBooking = kind === "booking" ? bookingByCalId.get(e.id) : null;
    events.push({
      id: e.id,
      kind,
      title: e.summary ?? "(no title)",
      startAt: e.start,
      endAt: e.end,
      location: e.location ?? null,
      // Booking events without a DB row open via this link; work/personal aren't openable.
      htmlLink: kind === "booking" ? (e.htmlLink ?? null) : null,
      // All-day events arrive as 24h timed events; treat >= 23h as a banner item.
      isAllDay: durationMs >= 23 * 60 * 60 * 1000,
      booking: matchedBooking
        ? {
            id: matchedBooking.id,
            cancelToken: matchedBooking.cancelToken,
            name: matchedBooking.name,
            email: matchedBooking.email,
            phone: matchedBooking.phone,
            address: matchedBooking.address,
            notes: matchedBooking.notes,
            status: matchedBooking.status,
          }
        : undefined,
    });
  }

  // Anchor each leg to its event's current times, since ends get edited to the actual finish.
  const rawEventById = new Map(rawEvents.map((e) => [e.id, e]));

  for (const b of travelBlocks) {
    const srcEvent = rawEventById.get(b.sourceEventId);
    if (!srcEvent) continue;
    const evStartMs = new Date(srcEvent.start).getTime();
    const evEndMs = new Date(srcEvent.end).getTime();

    if (b.beforeEventId && b.roundedMinutes != null) {
      events.push({
        id: b.beforeEventId,
        kind: "travel",
        title: `→ ${b.summary ?? "Travel"}`,
        startAt: new Date(evStartMs - b.roundedMinutes * 60_000).toISOString(),
        endAt: new Date(evStartMs).toISOString(),
        location: b.detectedOrigin ?? null,
        isAllDay: false,
      });
    }
    if (b.afterEventId && b.roundedBackMinutes != null && !b.travelBackSuppressed) {
      events.push({
        id: b.afterEventId,
        kind: "travel",
        title: `← ${b.customTravelBackDestination ?? "home"}`,
        startAt: new Date(evEndMs).toISOString(),
        endAt: new Date(evEndMs + b.roundedBackMinutes * 60_000).toISOString(),
        location: b.customTravelBackDestination ?? null,
        isAllDay: false,
      });
    }
  }

  // Holidays for the whole buffer in one batched read.
  const bufferedDayKeys: string[] = [];
  for (let i = -BUFFER_DAYS_BEFORE; i < BUFFER_DAYS_AFTER; i++) {
    bufferedDayKeys.push(nzDateKey(addDays(weekStartDate, i)));
  }
  const holidaysByKey = await lookupPublicHolidaysForKeys(bufferedDayKeys, {
    keepMoved: true,
  }).catch(() => new Map<string, { name: string; region: string }>());
  const holidaysByDateKey: Record<string, string> = {};
  for (const [key, h] of holidaysByKey) {
    // A weekend holiday taken on a weekday bills weekend rates, so say where the day off went.
    const takenOn = holidayTakenOn(key);
    holidaysByDateKey[key] = takenOn
      ? `${h.name} (day off ${new Date(`${takenOn}T00:00:00Z`).toLocaleDateString("en-NZ", { weekday: "long", timeZone: "UTC" })})`
      : h.name;
  }
  // Current week's day keys, at [BUFFER_DAYS_BEFORE, BUFFER_DAYS_BEFORE+7) of the buffer.
  const dayKeysInWeek = bufferedDayKeys.slice(BUFFER_DAYS_BEFORE, BUFFER_DAYS_BEFORE + 7);

  const todayKey = nzDateKey(now);
  const weekStartKey = nzDateKey(weekStartDate);
  // Requested day if in the visible week, else today if buffered, else the week's first day.
  const initialDayKey =
    day && /^\d{4}-\d{2}-\d{2}$/.test(day) && bufferedDayKeys.includes(day)
      ? day
      : bufferedDayKeys.includes(todayKey)
        ? todayKey
        : dayKeysInWeek[0]!;

  return (
    <>
      {/* Silent poll so externally-made calendar changes surface on their own. */}
      <ScheduleAutoRefresh
        fromIso={bufferStartIso}
        toIso={bufferEndIso}
        token={scheduleEventsToken(rawEvents)}
      />
      <PageHeader title="Schedule" />
      {unread && (
        <Notice tone="warn" onGrey className="mb-4 text-[0.9375rem] text-admin-text">
          {unread === "all"
            ? "Couldn't read Google Calendar, so the schedule below is missing its events. Refresh in a minute to try again."
            : "One of your Google calendars didn't load, so some events may be missing below. Refresh in a minute to try again."}
        </Notice>
      )}
      {/* Next-open-times bar - shared across the mobile agenda + desktop grid. */}
      <ScheduleFindTimes />
      <div className={"lg:hidden"}>
        {/* Keyed on weekStartKey so a new buffer reseeds useState. */}
        <DayAgendaView
          key={weekStartKey}
          initialDayKey={initialDayKey}
          todayKey={todayKey}
          bufferedDayKeys={bufferedDayKeys}
          events={events}
          holidaysByDateKey={holidaysByDateKey}
          lockHours={lockHours}
        />
      </div>
      <div className={"hidden lg:block"}>
        {/* Same key strategy as DayAgendaView. */}
        <WeekView
          key={weekStartKey}
          initialWeekStartIso={weekStartDate.toISOString()}
          bufferedDayKeys={bufferedDayKeys}
          events={events}
          holidaysByDateKey={holidaysByDateKey}
          lockHours={lockHours}
        />
      </div>
    </>
  );
}
