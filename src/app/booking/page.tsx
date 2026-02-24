// src/app/booking/page.tsx
/**
 * @file page.tsx
 * @description Booking page with duration-aware slot availability.
 */

import type React from "react";
import { cn } from "@/lib/cn";
import {
  BOOKING_CONFIG,
  buildAvailableDays,
  type ExistingBooking,
  type BookableDay,
} from "@/lib/booking";
import { prisma } from "@/lib/prisma";
import { fetchAllCalendarEvents } from "@/lib/google-calendar";
import BookingForm from "@/components/BookingForm";
import { FrostedSection, PageShell, CARD, SOFT_CARD } from "@/components/PageLayout";
import { FaCalendarCheck, FaClock, FaEnvelopeOpenText, FaListCheck } from "react-icons/fa6";

// ISR (Incremental Static Regeneration) with 5-minute revalidation window
// Ensures calendar availability is never more than 5 minutes stale
// (cron-job.org refreshes every 15 minutes, so 5-min ISR is a safe buffer)
export const revalidate = 300; // 5 minutes (300 seconds)

/**
 * Get calendar events, preferring cache but falling back to live API
 * @param now - Current date
 * @param maxDate - Maximum booking date
 * @returns Array of calendar events for blocking
 */
async function getCalendarEvents(
  now: Date,
  maxDate: Date,
): Promise<Array<{ id: string; start: string; end: string }>> {
  // Try cached events first
  const cachedEvents = await prisma.calendarEventCache.findMany({
    where: {
      expiresAt: { gt: now },
      endUtc: { gte: now },
    },
    select: {
      eventId: true,
      startUtc: true,
      endUtc: true,
    },
  });

  if (cachedEvents.length > 0) {
    console.log(`[booking/page] Using ${cachedEvents.length} cached calendar events`);
    return cachedEvents.map((e) => ({
      id: e.eventId,
      start: e.startUtc.toISOString(),
      end: e.endUtc.toISOString(),
    }));
  }

  // Cache empty — fetch directly from Google Calendar
  try {
    const liveEvents = await fetchAllCalendarEvents(now, maxDate);
    console.log(
      `[booking/page] Fetched ${liveEvents.length} live calendar events (cache was empty)`,
    );

    // Populate cache in background so the next request is fast
    const cacheExpiry = new Date(now.getTime() + 15 * 60 * 1000);
    void Promise.all(
      liveEvents.map((e) =>
        prisma.calendarEventCache.upsert({
          where: { eventId_calendarEmail: { eventId: e.id, calendarEmail: e.calendarEmail } },
          create: {
            eventId: e.id,
            calendarEmail: e.calendarEmail,
            startUtc: new Date(e.start),
            endUtc: new Date(e.end),
            fetchedAt: now,
            expiresAt: cacheExpiry,
          },
          update: {
            startUtc: new Date(e.start),
            endUtc: new Date(e.end),
            fetchedAt: now,
            expiresAt: cacheExpiry,
          },
        }),
      ),
    ).catch((err) => console.error("[booking/page] Failed to populate calendar cache:", err));

    return liveEvents.map((e) => ({
      id: e.id,
      start: e.start,
      end: e.end,
    }));
  } catch (error) {
    console.error("[booking/page] Failed to fetch live calendar events:", error);
    return [];
  }
}

/**
 * Fetch available days server-side with calendar blocking
 * @returns Promise resolving to array of bookable days
 */
async function getAvailableDays(): Promise<BookableDay[]> {
  const now = new Date();
  const maxDate = new Date(now.getTime() + BOOKING_CONFIG.maxAdvanceDays * 24 * 60 * 60 * 1000);

  // Run both DB queries in parallel
  const [existingBookings, calendarEvents] = await Promise.all([
    prisma.booking.findMany({
      where: {
        status: { in: ["held", "confirmed"] },
        endUtc: { gte: now },
      },
      select: {
        id: true,
        startUtc: true,
        endUtc: true,
        bufferBeforeMin: true,
        bufferAfterMin: true,
      },
    }),
    getCalendarEvents(now, maxDate),
  ]);

  const existingForSlots: ExistingBooking[] = existingBookings.map((b) => ({
    id: b.id,
    startUtc: b.startUtc,
    endUtc: b.endUtc,
    bufferBeforeMin: b.bufferBeforeMin,
    bufferAfterMin: b.bufferAfterMin,
  }));

  return buildAvailableDays(existingForSlots, calendarEvents, now, BOOKING_CONFIG);
}

const STEP_ICON = cn(
  "border-moonstone-500/40 bg-moonstone-600/20 grid size-9 shrink-0 place-items-center rounded-lg border",
);

/**
 * Booking page component
 * @returns React element for booking page
 */
export default async function BookingPage(): Promise<React.ReactElement> {
  const availableDays = await getAvailableDays();

  return (
    <PageShell>
      <FrostedSection maxWidth="90rem">
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          {/* Header */}
          <section className={cn(CARD, "animate-fade-in")}>
            <h1
              className={cn(
                "text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Request an appointment
            </h1>
            <p className={cn("text-rich-black text-sm sm:text-base")}>
              Pick a time that works for you and tell me what you need help with. I'll confirm the
              details and send you a calendar invite.
            </p>
          </section>

          {/* Two-column: Form + Sidebar */}
          <div className={cn("grid gap-6 sm:gap-8 lg:grid-cols-[1fr_20rem]")}>
            {/* Form Card */}
            <section className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}>
              <BookingForm availableDays={availableDays} />
            </section>

            {/* Sidebar */}
            <aside className={cn("flex flex-col gap-6 sm:gap-8 lg:sticky lg:top-24 lg:self-start")}>
              {/* How it works */}
              <div className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-200")}>
                <h2 className={cn("text-russian-violet mb-4 text-xl font-bold sm:text-2xl")}>
                  How it works
                </h2>
                <ol className={cn("space-y-5")}>
                  <li className={cn("flex gap-3")}>
                    <span className={STEP_ICON}>
                      <FaClock className={cn("text-moonstone-600 text-base")} aria-hidden />
                    </span>
                    <div>
                      <p className={cn("text-rich-black text-base font-semibold")}>Choose length</p>
                      <p className={cn("text-rich-black/70 text-sm")}>1 or 2 hours</p>
                    </div>
                  </li>
                  <li className={cn("flex gap-3")}>
                    <span className={STEP_ICON}>
                      <FaCalendarCheck className={cn("text-moonstone-600 text-base")} aria-hidden />
                    </span>
                    <div>
                      <p className={cn("text-rich-black text-base font-semibold")}>Pick a time</p>
                      <p className={cn("text-rich-black/70 text-sm")}>Day and start time</p>
                    </div>
                  </li>
                  <li className={cn("flex gap-3")}>
                    <span className={STEP_ICON}>
                      <FaListCheck className={cn("text-moonstone-600 text-base")} aria-hidden />
                    </span>
                    <div>
                      <p className={cn("text-rich-black text-base font-semibold")}>
                        Describe the issue
                      </p>
                      <p className={cn("text-rich-black/70 text-sm")}>What you need help with</p>
                    </div>
                  </li>
                  <li className={cn("flex gap-3")}>
                    <span className={STEP_ICON}>
                      <FaEnvelopeOpenText
                        className={cn("text-moonstone-600 text-base")}
                        aria-hidden
                      />
                    </span>
                    <div>
                      <p className={cn("text-rich-black text-base font-semibold")}>Get confirmed</p>
                      <p className={cn("text-rich-black/70 text-sm")}>Calendar invite by email</p>
                    </div>
                  </li>
                </ol>
              </div>

              {/* Info card */}
              <div
                className={cn(SOFT_CARD, "animate-slide-up animate-fill-both animate-delay-300")}
              >
                <p className={cn("text-rich-black/80 text-base leading-relaxed")}>
                  <strong>Timing is flexible.</strong> Most appointments are 1 hour. Choose 2 hours
                  if you have multiple issues or need more time. Actual time may be shorter or
                  longer as needed.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
