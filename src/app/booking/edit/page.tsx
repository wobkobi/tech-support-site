// src/app/booking/edit/page.tsx
/**
 * @file page.tsx
 * @description Edit an existing booking using the cancel token.
 */

import type React from "react";
import { notFound } from "next/navigation";
import { cn } from "@/shared/lib/cn";
import {
  BOOKING_CONFIG,
  DURATION_OPTIONS,
  TIME_OF_DAY_OPTIONS,
  SUB_SLOT_MINUTES,
  buildAvailableDays,
  type ExistingBooking,
  type BookableDay,
  type JobDuration,
  type TimeOfDay,
  type StartMinute,
} from "@/features/booking/lib/booking";
import { prisma } from "@/shared/lib/prisma";
import { fetchAllCalendarEvents } from "@/features/calendar/lib/google-calendar";
import BookingForm, {
  type BookingFormInitialValues,
} from "@/features/booking/components/BookingForm";
import { FrostedSection, PageShell, CARD } from "@/shared/components/PageLayout";

export const dynamic = "force-dynamic";

/**
 * Derive NZ dateKey (YYYY-MM-DD) from a UTC Date.
 * @param date - UTC date object.
 * @returns NZ local date string.
 */
function getNZDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Derive NZ local hour (24h) from a UTC Date.
 * @param date - UTC date object.
 * @returns NZ hour as a number.
 */
function getNZHour(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Auckland",
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  return parseInt(parts.find((p) => p.type === "hour")?.value ?? "0");
}

/**
 * Parse the structured booking notes back into form fields.
 * Notes format: "{userNotes}\n\n[{timeLabel} - {durationLabel}]\nMeeting type: ...\n[Address: ...]\n[Phone: ...]"
 * @param raw - Raw notes string from DB.
 * @returns Parsed fields.
 */
function parseBookingNotes(raw: string | null): {
  userNotes: string;
  meetingType: "in-person" | "remote" | "";
  address: string;
  phone: string;
} {
  if (!raw) return { userNotes: "", meetingType: "", address: "", phone: "" };

  const metaSeparatorIdx = raw.indexOf("\n\n[");
  const userNotes = metaSeparatorIdx >= 0 ? raw.slice(0, metaSeparatorIdx).trim() : raw.trim();
  const meta = metaSeparatorIdx >= 0 ? raw.slice(metaSeparatorIdx) : "";

  const meetingTypeLine = meta.match(/Meeting type:\s*(.+)/i)?.[1]?.trim() ?? "";
  const meetingType: "in-person" | "remote" | "" = meetingTypeLine
    .toLowerCase()
    .includes("in-person")
    ? "in-person"
    : meetingTypeLine.toLowerCase().includes("remote")
      ? "remote"
      : "";

  const address = meta.match(/Address:\s*(.+)/i)?.[1]?.trim() ?? "";
  const phone = meta.match(/Phone:\s*(.+)/i)?.[1]?.trim() ?? "";

  return { userNotes, meetingType, address, phone };
}

/**
 * Fetch available days excluding the booking being edited.
 * @param excludeBookingId - The booking being edited (freed up for re-selection).
 * @returns Array of bookable days.
 */
async function getAvailableDays(excludeBookingId: string): Promise<BookableDay[]> {
  const now = new Date();
  const maxDate = new Date(now.getTime() + BOOKING_CONFIG.maxAdvanceDays * 24 * 60 * 60 * 1000);

  const [existingBookings, cachedEvents] = await Promise.all([
    prisma.booking.findMany({
      where: {
        id: { not: excludeBookingId },
        status: { in: ["held", "confirmed"] },
        endAt: { gte: now },
      },
      select: { id: true, startAt: true, endAt: true, bufferBeforeMin: true, bufferAfterMin: true },
    }),
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

  const existing: ExistingBooking[] = existingBookings.map((b) => ({
    id: b.id,
    startAt: b.startAt,
    endAt: b.endAt,
    bufferBeforeMin: b.bufferBeforeMin,
    bufferAfterMin: b.bufferAfterMin,
  }));

  return buildAvailableDays(existing, calendarEvents, now, BOOKING_CONFIG);
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

  if (!cancelToken) notFound();

  const booking = await prisma.booking.findFirst({
    where: { cancelToken },
    select: {
      id: true,
      name: true,
      email: true,
      notes: true,
      startAt: true,
      endAt: true,
      status: true,
    },
  });

  if (!booking || booking.status === "cancelled") notFound();

  // Derive form values from stored booking
  const durationMinutes = (booking.endAt.getTime() - booking.startAt.getTime()) / 60000;
  const duration: JobDuration = durationMinutes <= 60 ? "short" : "long";

  const dateKey = getNZDateKey(booking.startAt);
  const nzHour = getNZHour(booking.startAt);
  const matchedSlot = TIME_OF_DAY_OPTIONS.find((t) => t.startHour === nzHour);
  const timeOfDay: TimeOfDay = (matchedSlot?.value ?? "10am") as TimeOfDay;
  // Minutes are timezone-independent - preserve the sub-slot offset
  const startMinute = (booking.startAt.getUTCMinutes() as StartMinute) ?? 0;

  const { userNotes, meetingType, address, phone } = parseBookingNotes(booking.notes);

  const initialValues: BookingFormInitialValues = {
    duration,
    dateKey,
    timeOfDay,
    startMinute,
    name: booking.name,
    email: booking.email,
    phone,
    meetingType,
    address,
    notes: userNotes,
  };

  const availableDays = await getAvailableDays(booking.id);

  // Ensure the current booking's day appears even if it has no other slots
  const hasCurrentDay = availableDays.some((d) => d.dateKey === dateKey);
  if (!hasCurrentDay) {
    const durationOption = DURATION_OPTIONS.find((d) => d.value === duration);
    availableDays.unshift({
      dateKey,
      dayLabel: new Intl.DateTimeFormat("en-NZ", {
        timeZone: "Pacific/Auckland",
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(booking.startAt),
      fullLabel: new Intl.DateTimeFormat("en-NZ", {
        timeZone: "Pacific/Auckland",
        weekday: "long",
        month: "short",
        day: "numeric",
      }).format(booking.startAt),
      isToday: false,
      isWeekend: [0, 6].includes(booking.startAt.getDay()),
      hasAnySlots: true,
      timeWindows: TIME_OF_DAY_OPTIONS.map((t) => {
        const isSelected = t.value === timeOfDay;
        const subSlots = SUB_SLOT_MINUTES.map((m) => ({
          minute: m,
          availableShort: isSelected && m === startMinute,
          availableLong:
            isSelected && m === startMinute && (durationOption?.durationMinutes ?? 60) >= 120,
        }));
        return {
          value: t.value as TimeOfDay,
          label: t.label,
          startHour: t.startHour,
          availableShort: isSelected,
          availableLong: isSelected && (durationOption?.durationMinutes ?? 60) >= 120,
          subSlots,
        };
      }),
    });
  }

  return (
    <PageShell>
      <FrostedSection>
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section className={cn(CARD, "animate-fade-in")}>
            <h1
              className={cn(
                "text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Edit booking
            </h1>
            <p className={cn("text-rich-black text-sm sm:text-base")}>
              Update your appointment details below. A new calendar invite will be sent when you
              save.
            </p>
          </section>

          <section className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}>
            <BookingForm
              availableDays={availableDays}
              cancelToken={cancelToken}
              initialValues={initialValues}
            />
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
