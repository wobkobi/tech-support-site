// src/app/booking/page.tsx
/**
 * @file page.tsx
 * @description Simplified booking page with day + time-of-day selection.
 */

import type React from "react";
import { PageShell, FrostedSection, PAGE_MAIN, CARD } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";
import { BOOKING_CONFIG, buildAvailableDays, type BookableDay } from "@/lib/booking";
import { fetchAllCalendarEvents } from "@/server/google/calendar";
import BookingForm from "@/components/BookingForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Fetch available days and time windows server-side.
 * @returns Array of available booking days.
 */
async function getAvailableDays(): Promise<BookableDay[]> {
  const now = new Date();
  const maxDate = new Date(now.getTime() + BOOKING_CONFIG.maxAdvanceDays * 24 * 60 * 60 * 1000);

  // Fetch events from both work and personal calendars
  let existingEvents;
  try {
    existingEvents = await fetchAllCalendarEvents(now, maxDate);
  } catch (error) {
    console.error("[booking/page] Failed to fetch calendar events:", error);
    existingEvents = [];
  }

  return buildAvailableDays(existingEvents, now, BOOKING_CONFIG);
}

/**
 * Booking page component.
 * Displays available days with time-of-day options.
 * @returns Booking page element.
 */
export default async function BookingPage(): Promise<React.ReactElement> {
  const availableDays = await getAvailableDays();

  return (
    <PageShell>
      <FrostedSection>
        <main className={cn(PAGE_MAIN)}>
          <section className={cn(CARD)}>
            <h1
              className={cn(
                "text-russian-violet mb-2 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Book an appointment
            </h1>
            <p className={cn("text-rich-black/80 mb-6 text-sm sm:text-base")}>
              Pick a day and time that works for you. I'll confirm the exact time based on my
              schedule. Same-day bookings available before 6pm.
            </p>

            <BookingForm availableDays={availableDays} />
          </section>

          <section className={cn(CARD)}>
            <h2 className={cn("text-russian-violet mb-2 text-lg font-bold sm:text-xl")}>
              How it works
            </h2>
            <ol
              className={cn(
                "text-rich-black/80 list-inside list-decimal space-y-1 text-sm sm:text-base",
              )}
            >
              <li>Choose your preferred day and time window</li>
              <li>Tell me what you need help with</li>
              <li>I'll confirm the exact time and send you a calendar invite</li>
            </ol>
          </section>
        </main>
      </FrostedSection>
    </PageShell>
  );
}
