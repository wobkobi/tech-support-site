// src/app/booking/page.tsx
/**
 * @file page.tsx
 * @description Simplified booking page - clients submit a time REQUEST,
 * unavailable times are blocked based on calendar events.
 */

import type React from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { BOOKING_CONFIG, buildAvailableDays, type BookableDay } from "@/lib/booking";
import { fetchAllCalendarEvents, type CalendarEvent } from "@/server/google/calendar";
import BookingForm from "@/components/BookingForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CARD = "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-5 shadow-sm sm:p-6";

/**
 * Fetch available days and time windows server-side.
 */
async function getAvailableDays(): Promise<BookableDay[]> {
  const now = new Date();
  const maxDate = new Date(now.getTime() + BOOKING_CONFIG.maxAdvanceDays * 24 * 60 * 60 * 1000);

  let existingEvents: CalendarEvent[] = [];
  try {
    existingEvents = await fetchAllCalendarEvents(now, maxDate);
  } catch (error) {
    console.error("[booking/page] Failed to fetch calendar events:", error);
  }

  return buildAvailableDays(existingEvents, now, BOOKING_CONFIG);
}

/**
 * Booking page component.
 */
export default async function BookingPage(): Promise<React.ReactElement> {
  const availableDays = await getAvailableDays();

  return (
    <main className={cn("relative min-h-dvh overflow-hidden")}>
      {/* Backdrop */}
      <div className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden")}>
        <Image
          src="/backdrop.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className={cn("scale-110 transform-gpu object-cover blur-xl")}
        />
      </div>

      {/* Frosted container */}
      <div className={cn("mx-auto my-5 w-full max-w-[min(100vw-2rem,56rem)] sm:my-10")}>
        <div
          className={cn(
            "border-seasalt-400/40 bg-seasalt-800/60 rounded-2xl border p-5 shadow-lg backdrop-blur-xl sm:p-10",
          )}
        >
          <div className={cn("flex flex-col gap-4 sm:gap-5")}>
            <section className={cn(CARD)}>
              <h1
                className={cn(
                  "text-russian-violet mb-2 text-2xl font-extrabold sm:text-3xl md:text-4xl",
                )}
              >
                Request an appointment
              </h1>
              <p className={cn("text-rich-black/80 mb-6 text-sm sm:text-base")}>
                Pick a day and preferred time window. I'll confirm the exact time based on my
                schedule and send you a calendar invite. Same-day requests available before 6pm.
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
          </div>
        </div>
      </div>
    </main>
  );
}
