// src/app/admin/(shell)/schedule/page.tsx
/**
 * @description Admin schedule page. Resolves the requested week from `?day=` or
 * `?weekStart=`, prefetches a {@link BUFFER_WEEKS}-week buffer of calendar and
 * travel events so day/week stepping stays client-side, and renders the desktop
 * {@link WeekView} grid and mobile {@link DayAgendaView}.
 */
import { DayAgendaView } from "@/features/admin/components/DayAgendaView";
import { ScheduleAutoRefresh } from "@/features/admin/components/ScheduleAutoRefresh";
import { ScheduleFindTimes } from "@/features/admin/components/ScheduleFindTimes";
import { WeekView } from "@/features/admin/components/WeekView";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { mondayOf, type WeekEvent, type WeekViewKind } from "@/features/admin/lib/schedule-types";
import { addDays, resolveWeekStart, toNZDateKey } from "@/features/admin/lib/week";
import { lookupPublicHolidaysForKeys } from "@/features/business/lib/pricing-policy.server";
import { getCachedScheduleEvents } from "@/features/calendar/lib/google-calendar";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Schedule - Admin",
  robots: { index: false, follow: false },
};

/**
 * Weeks of events to prefetch on each side of the requested week. Larger =
 * fewer server round-trips when stepping through weeks; smaller = faster
 * initial load.
 */
const BUFFER_WEEKS = 3;
const BUFFER_DAYS_BEFORE = BUFFER_WEEKS * 7;
const BUFFER_DAYS_AFTER = (BUFFER_WEEKS + 1) * 7;

/**
 * Admin week schedule page. Renders a 7-day grid showing booking, work, personal,
 * and travel events for the requested week. Empty slots are clickable to create a
 * manual booking from the modal.
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
  // Live past-edit lock window so the grid's pre-disable + copy match the
  // server-enforced value (scheduling.pastEditLockHours).
  const { scheduling } = await getSettings();
  const lockHours = scheduling.pastEditLockHours;

  const now = new Date();
  // Prefer ?day=YYYY-MM-DD when set so the buffered fetch centres on the
  // user's currently-viewed day's week; ?weekStart= is the desktop-grid
  // fallback. Falls through to today's week when neither is provided.
  const resolvedWeekStartParam = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? mondayOf(day) : weekStart;
  const weekStartDate = resolveWeekStart(resolvedWeekStartParam, now);
  // Prefetch BUFFER_WEEKS weeks either side of the requested week so the
  // mobile agenda can step day-by-day and the desktop grid can chevron
  // week-by-week without a server round-trip until the user walks past the
  // buffer.
  const bufferStartDate = addDays(weekStartDate, -BUFFER_DAYS_BEFORE);
  const bufferEndDate = addDays(weekStartDate, BUFFER_DAYS_AFTER);

  const bookingCalId = process.env.BOOKING_CALENDAR_ID ?? "";
  const carCalId = process.env.CAR_CALENDAR_ID ?? process.env.WORK_CALENDAR_ID ?? "";
  const personalCalId = process.env.PERSONAL_CALENDAR_ID ?? "";

  // Live calendar fetch covers all configured calendars for the 3-week
  // buffer so day-stepping across the visible-week boundary stays client-
  // side. Travel blocks queried separately because synthetic cache entries
  // don't carry their parent context.
  const [rawEvents, travelBlocks] = await Promise.all([
    getCachedScheduleEvents(bufferStartDate.toISOString(), bufferEndDate.toISOString()).catch(
      () => [],
    ),
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
    if (calendarEmail === carCalId) return "car";
    if (calendarEmail === personalCalId) return "personal";
    return "personal";
  }

  // Enrich booking-kind events with their Booking row so the day agenda can
  // expand to show customer details + drive quick-action mutations from the
  // card. Only joined for calendar events that came from the booking
  // calendar; travel/personal/car events have no matching row.
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
      // Booking-calendar events open on click: those with a DB row go to the in-app
      // detail page (via `booking` below); those without one (added straight into
      // Google Calendar) fall back to this link. Car/personal get none - not openable.
      htmlLink: kind === "booking" ? (e.htmlLink ?? null) : null,
      // fetchAllCalendarEvents converts all-day Google events to 24h timed events
      // spanning NZ midnight > midnight; treat anything >= 23h as a banner item.
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

  // Anchor each travel leg to its event's CURRENT times (matched by sourceEventId),
  // not the times cached on the block. The operator edits event ends to the actual
  // finish, so a block can carry a stale end until the travel cron recomputes -
  // anchoring live keeps the leg flush against the event instead of stranded inside
  // another one (a travel bar must never land in the middle of an event). Blocks
  // whose event is gone are dropped as orphans. Rounded minutes may lag by one cron
  // cycle, so a leg's length can be slightly off until then, but its POSITION is right.
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

  // Holiday lookups span the full buffered window so the agenda can show
  // holiday badges across the prefetched range without another fetch. One
  // batched read covers the whole window (the per-day variant costs a DB
  // round-trip per buffered day).
  const bufferedDayKeys: string[] = [];
  for (let i = -BUFFER_DAYS_BEFORE; i < BUFFER_DAYS_AFTER; i++) {
    bufferedDayKeys.push(toNZDateKey(addDays(weekStartDate, i)));
  }
  const holidaysByKey = await lookupPublicHolidaysForKeys(bufferedDayKeys).catch(
    () => new Map<string, { name: string; region: string }>(),
  );
  const holidaysByDateKey: Record<string, string> = {};
  for (const [key, h] of holidaysByKey) {
    holidaysByDateKey[key] = h.name;
  }
  // Current week's seven day keys - used to fall back to the week's first
  // day when the URL has no valid ?day=. The current week sits in the
  // middle of the buffer at index [BUFFER_DAYS_BEFORE, BUFFER_DAYS_BEFORE+7).
  const dayKeysInWeek = bufferedDayKeys.slice(BUFFER_DAYS_BEFORE, BUFFER_DAYS_BEFORE + 7);

  const todayKey = toNZDateKey(now);
  const weekStartKey = toNZDateKey(weekStartDate);
  // Pick the user-requested day when valid (inside the visible week);
  // otherwise prefer today if it falls inside the buffer; otherwise fall
  // back to the current-week's first day.
  const initialDayKey =
    day && /^\d{4}-\d{2}-\d{2}$/.test(day) && bufferedDayKeys.includes(day)
      ? day
      : bufferedDayKeys.includes(todayKey)
        ? todayKey
        : dayKeysInWeek[0];

  return (
    <>
      {/* Silent 30s poll so externally-made calendar changes surface on their own. */}
      <ScheduleAutoRefresh />
      <PageHeader title="Schedule" />
      {/* Next-open-times bar - shared across the mobile agenda + desktop grid. */}
      <ScheduleFindTimes />
      <div className={"lg:hidden"}>
        {/* Key on weekStartKey so a cross-buffer navigation reseeds the client
            state with the new initialDayKey - useState would otherwise keep
            the old selected day after the URL changes. */}
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
        {/* Same key strategy as DayAgendaView - remount when the server has
            built a fresh buffer around a new week. */}
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
