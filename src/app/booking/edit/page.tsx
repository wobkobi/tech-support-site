// src/app/booking/edit/page.tsx
// Edit an existing booking using the cancel token.

import BookingForm, {
  type BookingFormInitialValues,
} from "@/features/booking/components/BookingForm";
import { getAvailabilityConfig } from "@/features/booking/lib/availability-config.server";
import {
  DURATION_OPTIONS,
  bookingWindowEnd,
  buildAvailableDays,
  hourLabel,
  isBookingClosed,
  parseBookingNotes,
  type AvailabilityConfig,
  type BookableDay,
  type JobDuration,
  type TimeOfDay,
} from "@/features/booking/lib/booking";
import { loadBlockingBookings } from "@/features/booking/lib/existing-bookings.server";
import { withDateSurcharges } from "@/features/business/lib/pricing-policy.server";
import { fetchAllCalendarEvents } from "@/features/calendar/lib/google-calendar";
import { Button } from "@/shared/components/Button";
import { CARD, CardPage } from "@/shared/components/PageLayout";
import { PhoneLink } from "@/shared/components/PhoneLink";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { cn } from "@/shared/lib/cn";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NZ_TZ, nzDateKey, nzMinuteOfDay, nzWeekday } from "@/shared/lib/timezone-utils";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

// Token-gated editor reached from booking emails: keep it out of search results.
export const metadata: Metadata = {
  title: "Edit booking",
  robots: { index: false, follow: false },
};

/**
 * Fetch available days excluding the booking being edited.
 * @param booking - The booking being edited, freed up for re-selection.
 * @param booking.id - Its id, left out of the blocking bookings.
 * @param booking.calendarEventId - Its event, left out with the travel cached around it.
 * @param config - Live availability settings.
 * @returns Array of bookable days.
 */
async function getAvailableDays(
  booking: { id: string; calendarEventId: string | null },
  config: AvailabilityConfig,
): Promise<BookableDay[]> {
  const now = new Date();
  const maxDate = bookingWindowEnd(now, config);
  // The booking's own event and travel would grey out the slot it already holds.
  const own = new Set(
    booking.calendarEventId
      ? [
          booking.calendarEventId,
          `travel-before:${booking.calendarEventId}`,
          `travel-after:${booking.calendarEventId}`,
        ]
      : [],
  );

  const [existing, cachedEvents] = await Promise.all([
    loadBlockingBookings(now, { excludeId: booking.id }),
    prisma.calendarEventCache.findMany({
      where: { expiresAt: { gt: now }, endAt: { gte: now } },
      select: { eventId: true, startAt: true, endAt: true },
    }),
  ]);

  let calendarEvents: Array<{ id: string; start: string; end: string }>;

  if (cachedEvents.length > 0) {
    calendarEvents = cachedEvents.map((e) => ({
      id: e.eventId,
      start: e.startAt.toISOString(),
      end: e.endAt.toISOString(),
    }));
  } else {
    try {
      const liveEvents = await fetchAllCalendarEvents(now, maxDate);
      calendarEvents = liveEvents.map((e) => ({ id: e.id, start: e.start, end: e.end }));
    } catch {
      calendarEvents = [];
    }
  }

  return buildAvailableDays(
    existing,
    calendarEvents.filter((e) => !own.has(e.id)),
    now,
    config,
  ).days;
}

/**
 * The page for a link that can't open a booking, with the ways that still work: fresh links
 * by email (the cancel page offers the same), the phone, or a new booking.
 * @param props - Component props.
 * @param props.cancelled - The booking exists but was cancelled.
 * @param props.phone - Display phone number.
 * @param props.phoneTel - tel: URI for the same number.
 * @returns The page element.
 */
function LinkProblem({
  cancelled,
  phone,
  phoneTel,
}: {
  cancelled: boolean;
  phone: string;
  phoneTel: string;
}): React.ReactElement {
  return (
    <CardPage>
      <section className={cn(CARD, "animate-fade-in")}>
        <h1 className="mb-3 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl">
          {cancelled ? "This booking was cancelled" : "I couldn't find that booking"}
        </h1>
        <p className="mb-4 text-base text-rich-black sm:text-lg">
          {cancelled ? (
            "There's nothing left to change on it, but you're welcome to book a new time."
          ) : (
            <>
              This link may be from an older email. I can email you fresh links to change or cancel,
              or you can call or text me on <PhoneLink phone={phone} phoneTel={phoneTel} /> and
              I&apos;ll sort it out.
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-3">
          {cancelled ? (
            <Button href="/booking" variant="secondary" size="md">
              Book a new time
            </Button>
          ) : (
            <Button href="/booking/manage" variant="secondary" size="md">
              Email me fresh links
            </Button>
          )}
          <Button href="/" variant="ghost" size="md">
            Back to home
          </Button>
        </div>
      </section>
    </CardPage>
  );
}

/**
 * Edit booking page.
 * @param props - Page props.
 * @param props.searchParams - URL search params containing the cancel token.
 * @returns Edit booking page element.
 */
export default async function EditBookingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const tokenValue = params.token;
  const cancelToken = Array.isArray(tokenValue) ? tokenValue[0] : tokenValue;

  // Load the booking by token
  const booking = cancelToken
    ? await prisma.booking.findFirst({
        where: { cancelToken },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          notes: true,
          accessNotes: true,
          startAt: true,
          endAt: true,
          status: true,
          rescheduleCount: true,
          calendarEventId: true,
          duration: true,
        },
      })
    : null;

  if (!cancelToken || !booking || booking.status === "cancelled") {
    const identity = await getIdentity();
    return (
      <LinkProblem
        cancelled={booking?.status === "cancelled"}
        phone={identity.phone}
        phoneTel={identity.phoneTel}
      />
    );
  }

  // Load in parallel; the day list starts once the config is in (blocked bookings
  // waste one lookup, which is rare).
  const [{ pricing }, identity, { config: availabilityConfig }] = await Promise.all([
    getSettings(),
    getIdentity(),
    getAvailabilityConfig(),
  ]);
  const availableDaysPromise = getAvailableDays(booking, availabilityConfig);
  // Mirror the POST route's reschedule gate (api/booking/edit/route.ts) so the
  // customer learns they can't change this booking BEFORE filling the form in,
  // instead of getting a rejection after submitting. 0 / null means "rule off".
  const { reschedule } = pricing;
  const now = new Date();
  const closed = isBookingClosed(booking, now);
  const hoursUntilStart = (booking.startAt.getTime() - now.getTime()) / 3_600_000;
  const cutoffBlocked = reschedule.cutoffHours > 0 && hoursUntilStart < reschedule.cutoffHours;
  const limitBlocked =
    reschedule.maxReschedules !== null && booking.rescheduleCount >= reschedule.maxReschedules;
  const blocked = closed || cutoffBlocked || limitBlocked;
  const changesLeft =
    reschedule.maxReschedules !== null
      ? Math.max(0, reschedule.maxReschedules - booking.rescheduleCount)
      : null;

  // The booked length, not the event's span: the operator may have moved the finish since.
  // Legacy rows without the column fall back to the span.
  const durationMinutes = (booking.endAt.getTime() - booking.startAt.getTime()) / 60000;
  const duration: JobDuration = booking.duration ?? (durationMinutes <= 60 ? "short" : "long");

  // The grid labels every hour the schedule opens, so any start maps to its own label.
  const dateKey = nzDateKey(booking.startAt);
  const startMinuteOfDay = nzMinuteOfDay(booking.startAt);
  const nzHour = Math.floor(startMinuteOfDay / 60);
  const timeOfDay: TimeOfDay = hourLabel(nzHour);
  const startMinute = startMinuteOfDay % 60;

  const { userNotes, meetingType, address } = parseBookingNotes(booking.notes);

  const initialValues: BookingFormInitialValues = {
    duration,
    dateKey,
    timeOfDay,
    startMinute,
    name: booking.name,
    email: booking.email,
    // Read the phone from the Booking column, not the notes: the original
    // request route never writes a "Phone:" note line, so parsing it back would
    // yield "" and blank the number on save.
    phone: booking.phone ?? "",
    meetingType,
    address,
    notes: userNotes,
    accessNotes: booking.accessNotes ?? "",
  };

  const availableDays = await availableDaysPromise;

  // Ensure the current booking's day appears even if it has no other slots
  const hasCurrentDay = availableDays.some((d) => d.dateKey === dateKey);
  if (!hasCurrentDay) {
    const durationOption = DURATION_OPTIONS.find((d) => d.value === duration);
    const isLong = (durationOption?.durationMinutes ?? 60) >= 120;
    availableDays.unshift({
      dateKey,
      dayLabel: new Intl.DateTimeFormat("en-NZ", {
        timeZone: NZ_TZ,
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(booking.startAt),
      fullLabel: new Intl.DateTimeFormat("en-NZ", {
        timeZone: NZ_TZ,
        weekday: "long",
        month: "short",
        day: "numeric",
      }).format(booking.startAt),
      isToday: false,
      isTomorrow: false,
      isWeekend: [0, 6].includes(nzWeekday(booking.startAt)),
      hasAnySlots: true,
      // Only the slot it already holds: nothing else on the day was free.
      timeWindows: [
        {
          value: timeOfDay,
          label: timeOfDay,
          startHour: nzHour,
          availableShort: true,
          availableLong: isLong,
          subSlots: availabilityConfig.subSlotMinutes.map((m) => ({
            minute: m,
            availableShort: m === startMinute,
            availableLong: m === startMinute && isLong,
          })),
        },
      ],
    });
  }
  // A reschedule onto a weekend or public holiday shows the same surcharge note as a new booking.
  const pricedDays = await withDateSurcharges(availableDays);

  return (
    <CardPage>
      <div className="flex flex-col gap-6 sm:gap-8">
        <section className={cn(CARD, "animate-fade-in")}>
          <h1 className="mb-3 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl">
            Edit booking
          </h1>
          <p className="text-base text-rich-black">
            {blocked
              ? "This booking can no longer be changed online."
              : "Update your appointment details below. If you pick a new time, a new calendar invite is sent when you save."}
          </p>
        </section>

        {blocked ? (
          /* The server would reject a save anyway, so don't show a form that
               can only fail - explain why and offer the paths that still work. */
          <section className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}>
            <h2 className="mb-2 text-lg font-bold text-russian-violet sm:text-xl">
              {closed
                ? "This appointment has passed"
                : cutoffBlocked
                  ? "Too close to your appointment"
                  : "Move limit reached"}
            </h2>
            <p className="mb-4 text-base text-rich-black/80 sm:text-lg">
              {closed
                ? "This appointment has already started or finished."
                : cutoffBlocked
                  ? `Bookings can't be changed within ${reschedule.cutoffHours} hours of the appointment.`
                  : "This booking has already been moved the maximum number of times."}{" "}
              Give me a call or text and I'll sort it out for you.
            </p>
            <div className="flex flex-wrap gap-3">
              {identity.phoneTel && (
                <Button href={identity.phoneTel} variant="secondary" size="md">
                  Call {identity.phone}
                </Button>
              )}
              {/* A passed appointment has nothing left to cancel. */}
              {!closed && (
                <Button
                  href={`/booking/cancel?token=${encodeURIComponent(cancelToken)}`}
                  variant="ghost"
                  size="md"
                >
                  Cancel instead
                </Button>
              )}
            </div>
          </section>
        ) : (
          <section className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}>
            {/* Only worth saying when a limit is actually configured. */}
            {(changesLeft !== null || reschedule.cutoffHours > 0) && (
              <p className="mb-4 rounded-lg border border-mustard-400 bg-mustard-50 px-4 py-3 text-base text-rich-black/80">
                {changesLeft !== null && (
                  <>
                    You can move this booking to a new time{" "}
                    <strong>
                      {changesLeft} more {changesLeft === 1 ? "time" : "times"}
                    </strong>
                    . Changing only your details doesn&apos;t count.{" "}
                  </>
                )}
                {reschedule.cutoffHours > 0 && (
                  <>
                    Changes close <strong>{reschedule.cutoffHours} hours before</strong> your
                    appointment.
                  </>
                )}
              </p>
            )}
            <BookingForm
              availableDays={pricedDays}
              durations={availabilityConfig.durations}
              cancelToken={cancelToken}
              initialValues={initialValues}
              phone={identity.phone}
              phoneTel={identity.phoneTel}
            />
          </section>
        )}
      </div>
    </CardPage>
  );
}
