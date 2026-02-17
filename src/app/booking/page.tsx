// src/app/booking/page.tsx
/**
 * @file page.tsx
 * @description Booking page with duration-aware slot availability
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
import BookingForm from "@/components/BookingForm";
import { FrostedSection, PageShell, CARD } from "@/components/SiteFrame";

export const dynamic = "force-dynamic";
export const revalidate = 60; // Cache for 60 seconds to reduce API load

/**
 * Fetch available days server-side with calendar blocking
 * @returns Promise resolving to array of bookable days
 */
async function getAvailableDays(): Promise<BookableDay[]> {
  const now = new Date();

  // Parallelize database queries for bookings and cached calendar events
  const [existingBookings, cachedCalendarEvents] = await Promise.all([
    // Get existing bookings from database
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
    // Get cached calendar events from database (much faster than API call)
    prisma.calendarEventCache.findMany({
      where: {
        expiresAt: { gt: now },
        endUtc: { gte: now },
      },
      select: {
        eventId: true,
        startUtc: true,
        endUtc: true,
      },
    }),
  ]);

  const existingForSlots: ExistingBooking[] = existingBookings.map((b: typeof existingBookings[number]) => ({
    id: b.id,
    startUtc: b.startUtc,
    endUtc: b.endUtc,
    bufferBeforeMin: b.bufferBeforeMin,
    bufferAfterMin: b.bufferAfterMin,
  }));

  const calendarEvents = cachedCalendarEvents.map((e: typeof cachedCalendarEvents[number]) => ({
    id: e.eventId,
    start: e.startUtc.toISOString(),
    end: e.endUtc.toISOString(),
  }));

  console.log(`[booking/page] Using ${calendarEvents.length} cached calendar events for blocking`);

  return buildAvailableDays(existingForSlots, calendarEvents, now, BOOKING_CONFIG);
}

/**
 * Booking page component
 * @returns React element for booking page
 */
export default async function BookingPage(): Promise<React.ReactElement> {
  const availableDays = await getAvailableDays();

  return (
    <PageShell>
      <FrostedSection>
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section className={cn(CARD, "animate-fade-in")}>
            <h1
              className={cn(
                "text-russian-violet mb-4 text-3xl font-extrabold sm:text-4xl md:text-5xl",
              )}
            >
              Request an appointment
            </h1>
            <p className={cn("text-rich-black mb-6 text-base sm:text-lg md:text-xl")}>
              Pick a time that works for you and tell me what you need help with. I'll confirm
              the details and send you a calendar invite.
            </p>

            <BookingForm availableDays={availableDays} />
          </section>

          <section className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}>
            <h2 className={cn("text-russian-violet mb-3 text-xl font-bold sm:text-2xl")}>
              How it works
            </h2>
            <ol className={cn("text-rich-black space-y-2.5 text-base sm:text-lg")}>
              <li className={cn("flex gap-3")}>
                <span className={cn("text-moonstone-600")}>1.</span>
                <span>Choose appointment length (1 or 2 hours)</span>
              </li>
              <li className={cn("flex gap-3")}>
                <span className={cn("text-moonstone-600")}>2.</span>
                <span>Pick your preferred day and start time</span>
              </li>
              <li className={cn("flex gap-3")}>
                <span className={cn("text-moonstone-600")}>3.</span>
                <span>Tell me what you need help with</span>
              </li>
              <li className={cn("flex gap-3")}>
                <span className={cn("text-moonstone-600")}>4.</span>
                <span>I'll confirm the time and send you a calendar invite</span>
              </li>
            </ol>
            <p className={cn("text-rich-black/80 mt-4 text-base sm:text-lg")}>
              <strong>Timing is flexible:</strong> Most appointments are 1 hour. Choose 2 hours
              if you have multiple issues or need more time. Actual time may be shorter or longer
              as needed.
            </p>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
