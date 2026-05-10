// src/app/booking/page.tsx
/**
 * @file page.tsx
 * @description Booking page with duration-aware slot availability.
 *   The static shell (heading, sidebar, skeleton) renders immediately while
 *   the slot data is streamed in via a Suspense boundary, so TTFB stays
 *   constant even when the calendar cache is cold and we have to hit the
 *   live Google Calendar API.
 */

import type { Metadata } from "next";
import type React from "react";
import { Suspense } from "react";
import { cn } from "@/shared/lib/cn";
import {
  BOOKING_CONFIG,
  buildAvailableDays,
  type ExistingBooking,
  type BookableDay,
} from "@/features/booking/lib/booking";
import { prisma } from "@/shared/lib/prisma";
import { fetchAllCalendarEvents } from "@/features/calendar/lib/google-calendar";
import BookingForm from "@/features/booking/components/BookingForm";
import { FrostedSection, PageShell, CARD, SOFT_CARD } from "@/shared/components/PageLayout";
import { BreadcrumbJsonLd } from "@/shared/components/BreadcrumbJsonLd";
import { FaCalendarCheck, FaClock, FaEnvelopeOpenText, FaListCheck } from "react-icons/fa6";

export const metadata: Metadata = {
  title: "Book a Tech Support Appointment in Auckland",
  description:
    "Book an on-site or remote tech support appointment in Auckland. Same-day, evening and weekend slots available. Pick a 1- or 2-hour slot and get an instant calendar invite.",
  keywords: [
    "book tech support Auckland",
    "computer repair appointment Auckland",
    "IT support booking Auckland",
    "same day tech support Auckland",
    "weekend computer help Auckland",
  ],
  alternates: { canonical: "/booking" },
  openGraph: {
    title: "Book an Appointment - To The Point Tech",
    description: "Same-day, evening and weekend tech support appointments across Auckland.",
    url: "/booking",
  },
};

// Always render fresh - slot availability is time-sensitive and ISR can serve
// stale pages indefinitely on low-traffic routes (Vercel only revalidates on
// the next request *after* the window, not proactively).
export const dynamic = "force-dynamic";

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
      endAt: { gte: now },
    },
    select: {
      eventId: true,
      startAt: true,
      endAt: true,
    },
  });

  if (cachedEvents.length > 0) {
    console.log(`[booking/page] Using ${cachedEvents.length} cached calendar events`);
    return cachedEvents.map((e) => ({
      id: e.eventId,
      start: e.startAt.toISOString(),
      end: e.endAt.toISOString(),
    }));
  }

  // Cache empty - fetch directly from Google Calendar
  try {
    const liveEvents = await fetchAllCalendarEvents(now, maxDate);
    console.log(
      `[booking/page] Fetched ${liveEvents.length} live calendar events (cache was empty)`,
    );

    // Populate cache in background so the next request is fast.
    // Matches the cron writer's 30-min TTL (cron runs every 15 min).
    const cacheExpiry = new Date(now.getTime() + 30 * 60 * 1000);
    void Promise.all(
      liveEvents.map((e) =>
        prisma.calendarEventCache.upsert({
          where: { eventId_calendarEmail: { eventId: e.id, calendarEmail: e.calendarEmail } },
          create: {
            eventId: e.id,
            calendarEmail: e.calendarEmail,
            startAt: new Date(e.start),
            endAt: new Date(e.end),
            fetchedAt: now,
            expiresAt: cacheExpiry,
          },
          update: {
            startAt: new Date(e.start),
            endAt: new Date(e.end),
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
        endAt: { gte: now },
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        bufferBeforeMin: true,
        bufferAfterMin: true,
      },
    }),
    getCalendarEvents(now, maxDate),
  ]);

  const existingForSlots: ExistingBooking[] = existingBookings.map((b) => ({
    id: b.id,
    startAt: b.startAt,
    endAt: b.endAt,
    bufferBeforeMin: b.bufferBeforeMin,
    bufferAfterMin: b.bufferAfterMin,
  }));

  return buildAvailableDays(existingForSlots, calendarEvents, now, BOOKING_CONFIG);
}

const STEP_ICON = cn(
  "border-moonstone-500/40 bg-moonstone-600/20 grid size-9 shrink-0 place-items-center rounded-lg border",
);

const SKELETON_BLOCK = cn("bg-seasalt-900/40 rounded-lg");

/**
 * Async island that fetches slot data and renders the booking form. Held
 * inside a Suspense boundary so the rest of the page can flush instantly.
 * @returns Booking form populated with available days.
 */
async function BookingFormIsland(): Promise<React.ReactElement> {
  const availableDays = await getAvailableDays();
  return <BookingForm availableDays={availableDays} />;
}

/**
 * Skeleton shown while BookingFormIsland streams in. Matches the rough
 * visual height of the real form to avoid layout shift on hydration.
 * @returns Skeleton placeholder element.
 */
function BookingFormSkeleton(): React.ReactElement {
  return (
    <div
      className={cn("flex animate-pulse flex-col gap-8")}
      role="status"
      aria-live="polite"
      aria-label="Loading booking form"
    >
      {/* Schedule header */}
      <div className={cn("flex flex-col gap-6")}>
        <div className={cn(SKELETON_BLOCK, "h-7 w-32")} />

        {/* Duration */}
        <div className={cn("flex flex-col gap-2")}>
          <div className={cn(SKELETON_BLOCK, "h-5 w-48")} />
          <div className={cn("grid gap-3 sm:grid-cols-2")}>
            <div className={cn(SKELETON_BLOCK, "h-20")} />
            <div className={cn(SKELETON_BLOCK, "h-20")} />
          </div>
        </div>

        {/* Days */}
        <div className={cn("flex flex-col gap-2")}>
          <div className={cn(SKELETON_BLOCK, "h-5 w-32")} />
          <div className={cn(SKELETON_BLOCK, "h-4 w-20")} />
          <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2")}>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className={cn(SKELETON_BLOCK, "h-12")} />
            ))}
          </div>
        </div>

        {/* Times */}
        <div className={cn("flex flex-col gap-2")}>
          <div className={cn(SKELETON_BLOCK, "h-5 w-40")} />
          <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2")}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={cn(SKELETON_BLOCK, "h-11")} />
            ))}
          </div>
        </div>
      </div>

      <hr className={cn("border-seasalt-400/80")} />

      {/* Your details */}
      <div className={cn("flex flex-col gap-6")}>
        <div className={cn(SKELETON_BLOCK, "h-7 w-36")} />
        <div className={cn("grid gap-4 sm:grid-cols-2")}>
          <div className={cn(SKELETON_BLOCK, "h-12")} />
          <div className={cn(SKELETON_BLOCK, "h-12")} />
        </div>
        <div className={cn(SKELETON_BLOCK, "h-12 sm:max-w-sm")} />
        <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2")}>
          <div className={cn(SKELETON_BLOCK, "h-11")} />
          <div className={cn(SKELETON_BLOCK, "h-11")} />
        </div>
      </div>

      <hr className={cn("border-seasalt-400/80")} />

      {/* Notes */}
      <div className={cn("flex flex-col gap-2")}>
        <div className={cn(SKELETON_BLOCK, "h-5 w-56")} />
        <div className={cn(SKELETON_BLOCK, "h-28")} />
      </div>

      {/* Submit */}
      <div className={cn(SKELETON_BLOCK, "h-12 w-44")} />

      <span className={cn("sr-only")}>Loading available appointment times...</span>
    </div>
  );
}

/**
 * Booking page component
 * @returns React element for booking page
 */
export default function BookingPage(): React.ReactElement {
  return (
    <PageShell>
      <BreadcrumbJsonLd
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Book", path: "/booking" },
        ]}
      />
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
              <br />
              Prefer to call or text? Feel free to reach out directly.
            </p>
          </section>

          {/* Two-column: Form + Sidebar */}
          <div className={cn("grid gap-6 sm:gap-8 lg:grid-cols-[1fr_20rem]")}>
            {/* Form Card - data island streams in inside the Suspense boundary */}
            <section
              className={cn(
                CARD,
                "animate-slide-up animate-fill-both animate-delay-100 order-2 lg:order-1",
              )}
            >
              <Suspense fallback={<BookingFormSkeleton />}>
                <BookingFormIsland />
              </Suspense>
            </section>

            {/* Sidebar */}
            <aside
              className={cn(
                "sticky order-1 flex flex-col gap-6 sm:gap-8 lg:top-24 lg:order-2 lg:self-start",
              )}
            >
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
                      <p className={cn("text-rich-black/70 text-base")}>1 or 2 hours</p>
                    </div>
                  </li>
                  <li className={cn("flex gap-3")}>
                    <span className={STEP_ICON}>
                      <FaCalendarCheck className={cn("text-moonstone-600 text-base")} aria-hidden />
                    </span>
                    <div>
                      <p className={cn("text-rich-black text-base font-semibold")}>Pick a time</p>
                      <p className={cn("text-rich-black/70 text-base")}>Day and start time</p>
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
                      <p className={cn("text-rich-black/70 text-base")}>What you need help with</p>
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
                      <p className={cn("text-rich-black/70 text-base")}>Calendar invite by email</p>
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
