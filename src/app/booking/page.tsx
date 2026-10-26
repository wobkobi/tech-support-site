// src/app/booking/page.tsx
// Booking page. The static shell renders at once and slot data streams in via Suspense,
// so TTFB stays flat on a cold calendar cache.

import BookingForm from "@/features/booking/components/BookingForm";
import { getAvailabilityConfig } from "@/features/booking/lib/availability-config.server";
import {
  buildAvailableDays,
  hourLabel,
  type BookableDay,
  type ExistingBooking,
} from "@/features/booking/lib/booking";
import { withDateSurcharges } from "@/features/business/lib/pricing-policy.server";
import { hasActivePromoCode } from "@/features/business/lib/promos";
import { fetchAllCalendarEvents } from "@/features/calendar/lib/google-calendar";
import { BreadcrumbJsonLd } from "@/shared/components/BreadcrumbJsonLd";
import { CARD, CardPage, SOFT_CARD } from "@/shared/components/PageLayout";
import { PhoneLink } from "@/shared/components/PhoneLink";
import { PixelEvent } from "@/shared/components/PixelEvent";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { cn } from "@/shared/lib/cn";
import { pageOpenGraph } from "@/shared/lib/open-graph";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";
import { Suspense } from "react";
import { FaCalendarCheck, FaClock, FaEnvelopeOpenText, FaListCheck } from "react-icons/fa6";

const TITLE = "Book Tech Support in Auckland";
const DESCRIPTION =
  "Book an on-site or remote tech support appointment in Auckland. Same-day and weekend slots, with an instant calendar invite.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/booking" },
  openGraph: pageOpenGraph({ title: TITLE, description: DESCRIPTION, url: "/booking" }),
};

// Slots are time-sensitive; ISR can serve stale pages indefinitely on low-traffic routes.
export const dynamic = "force-dynamic";

interface CalendarFetchResult {
  events: Array<{ id: string; start: string; end: string }>;
  /** True when cache was empty AND live fetch failed; UI should hide slots. */
  degraded: boolean;
}

// How long past its TTL a cached event stays servable; covers missed cron runs.
// The submit-time conflict check still guards double-booking.
const STALE_SERVE_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Fetch live calendar events and repopulate the cache in the background.
 * @param now - Current date
 * @param maxDate - Maximum booking date
 * @returns Live events from the Google Calendar API.
 */
async function fetchLiveAndCache(
  now: Date,
  maxDate: Date,
): Promise<Array<{ id: string; start: string; end: string }>> {
  const liveEvents = await fetchAllCalendarEvents(now, maxDate);
  console.log(`[booking/page] Fetched ${liveEvents.length} live calendar events`);

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

  return liveEvents.map((e) => ({ id: e.id, start: e.start, end: e.end }));
}

/**
 * Get calendar events: fresh cache, then stale-while-revalidate, blocking on the live
 * API only when nothing usable is cached.
 * @param now - Current date
 * @param maxDate - Maximum booking date
 * @returns Events plus a `degraded` flag for the no-data state.
 */
async function getCalendarEvents(now: Date, maxDate: Date): Promise<CalendarFetchResult> {
  // One read covers fresh and stale rows; expiresAt decides which path below.
  const cachedEvents = await prisma.calendarEventCache.findMany({
    where: {
      fetchedAt: { gt: new Date(now.getTime() - STALE_SERVE_WINDOW_MS) },
      endAt: { gte: now },
    },
    select: {
      eventId: true,
      startAt: true,
      endAt: true,
      expiresAt: true,
    },
  });

  if (cachedEvents.length > 0) {
    const hasExpired = cachedEvents.some((e) => e.expiresAt <= now);
    if (hasExpired) {
      // Missed cron: serve the expired rows, refresh in the background.
      console.log(
        `[booking/page] Serving ${cachedEvents.length} stale cached calendar events; refreshing in background`,
      );
      void fetchLiveAndCache(now, maxDate).catch((err) =>
        console.error("[booking/page] Background calendar refresh failed:", err),
      );
    } else {
      console.log(`[booking/page] Using ${cachedEvents.length} cached calendar events`);
    }
    return {
      events: cachedEvents.map((e) => ({
        id: e.eventId,
        start: e.startAt.toISOString(),
        end: e.endAt.toISOString(),
      })),
      degraded: false,
    };
  }

  // Nothing usable cached - block on the live API.
  try {
    return { events: await fetchLiveAndCache(now, maxDate), degraded: false };
  } catch (error) {
    console.error("[booking/page] Failed to fetch live calendar events:", error);
    return { events: [], degraded: true };
  }
}

/**
 * Fetch available days server-side with calendar blocking.
 * @returns Bookable days plus the calendar `degraded` and `sameDayClosed` flags.
 */
async function getAvailableDays(): Promise<{
  days: BookableDay[];
  degraded: boolean;
  sameDayClosed: boolean;
  acceptingBookings: boolean;
  closedMessage: string;
  durations: { short: number; long: number };
  minHoursNotice: number;
  sameDayCutoffHour: number | null;
}> {
  const now = new Date();
  const { config, acceptingBookings, closedMessage } = await getAvailabilityConfig();

  // Master switch: when paused, skip the slot build and surface the message.
  if (!acceptingBookings) {
    return {
      days: [],
      degraded: false,
      sameDayClosed: false,
      acceptingBookings: false,
      closedMessage,
      durations: config.durations,
      minHoursNotice: config.minHoursNotice,
      sameDayCutoffHour: config.sameDayCutoffHour,
    };
  }

  const maxDate = new Date(now.getTime() + config.maxAdvanceDays * 24 * 60 * 60 * 1000);

  // Load blocking bookings and calendar events
  const [existingBookings, calendar] = await Promise.all([
    prisma.booking.findMany({
      where: {
        status: "confirmed",
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

  // Build the bookable-day grid
  const existingForSlots: ExistingBooking[] = existingBookings.map((b) => ({
    id: b.id,
    startAt: b.startAt,
    endAt: b.endAt,
    bufferBeforeMin: b.bufferBeforeMin,
    bufferAfterMin: b.bufferAfterMin,
  }));

  const built = buildAvailableDays(existingForSlots, calendar.events, now, config);
  return {
    days: built.days,
    degraded: calendar.degraded,
    sameDayClosed: built.sameDayClosed,
    acceptingBookings: true,
    closedMessage,
    durations: config.durations,
    minHoursNotice: config.minHoursNotice,
    sameDayCutoffHour: config.sameDayCutoffHour,
  };
}

const STEP_ICON =
  "border-moonstone-500/40 bg-moonstone-400/20 grid size-9 shrink-0 place-items-center rounded-lg border";

const SKELETON_BLOCK = "bg-white/40 rounded-lg";

/**
 * Async island that fetches slot data inside the {@link Suspense} boundary. Renders
 * an unavailable banner instead of the form when the calendar fetch failed.
 * @returns Booking form or an unavailable banner.
 */
async function BookingFormIsland(): Promise<React.ReactElement> {
  const {
    days,
    degraded,
    sameDayClosed,
    acceptingBookings,
    closedMessage,
    durations,
    minHoursNotice,
    sameDayCutoffHour,
  } = await getAvailableDays();
  // A failed promo lookup shows the code box rather than hiding a code that works.
  const [settings, showPromoCode, pricedDays] = await Promise.all([
    getSettings(),
    hasActivePromoCode().catch(() => true),
    withDateSurcharges(days),
  ]);
  // Explain the same-day closure from live settings.
  const sameDayReasons: string[] = [];
  if (minHoursNotice > 0) {
    sameDayReasons.push(`${minHoursNotice} hour${minHoursNotice === 1 ? "" : "s"} notice required`);
  }
  if (sameDayCutoffHour !== null) {
    sameDayReasons.push(`${hourLabel(sameDayCutoffHour)} cut-off`);
  }
  const sameDayDetail = sameDayReasons.length ? ` (${sameDayReasons.join(", ")})` : "";
  if (!acceptingBookings) {
    return (
      <div
        role="status"
        className="flex flex-col gap-2 rounded-lg border-2 border-mustard-300/60 bg-mustard-50/40 p-5 text-rich-black"
      >
        <p className="text-base font-semibold">Online booking is paused</p>
        <p className="text-base">{closedMessage}</p>
        <p className="text-base">
          Call or text me on{" "}
          <PhoneLink phone={settings.identity.phone} phoneTel={settings.identity.phoneTel} />.
        </p>
      </div>
    );
  }
  if (degraded) {
    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-lg border-2 border-coquelicot-500/60 bg-coquelicot-50 p-5 text-rich-black"
      >
        <p className="text-base font-semibold sm:text-lg">Availability isn't loading right now.</p>
        <p className="text-base sm:text-lg">
          Please refresh the page in a minute, or call or text me on{" "}
          <PhoneLink phone={settings.identity.phone} phoneTel={settings.identity.phoneTel} /> and
          I'll get you booked in.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {sameDayClosed && (
        <div className="rounded-lg border border-moonstone-500/40 bg-moonstone-400/10 p-4 text-rich-black">
          <p className="text-base">
            Same-day bookings are closed for today{sameDayDetail}. The earliest available time is
            tomorrow.
          </p>
        </div>
      )}
      <BookingForm
        availableDays={pricedDays}
        durations={durations}
        estimatorRange={settings.estimator.range}
        lowEndFloorFactor={settings.estimator.lowEndFloorFactor}
        minBillableMins={settings.pricing.minBillableMins}
        minTravelCharge={settings.pricing.minTravelCharge}
        travelRatePerHour={settings.pricing.travelRatePerHour}
        phone={settings.identity.phone}
        phoneTel={settings.identity.phoneTel}
        showPromoCode={showPromoCode}
      />
    </div>
  );
}

/**
 * Skeleton for {@link BookingFormIsland}; must match the real form's height to avoid layout shift.
 * @returns Skeleton placeholder element.
 */
function BookingFormSkeleton(): React.ReactElement {
  return (
    <div
      className="flex animate-pulse flex-col gap-8"
      role="status"
      aria-live="polite"
      aria-label="Loading booking form"
    >
      {/* Schedule header */}
      <div className="flex flex-col gap-6">
        <div className={cn(SKELETON_BLOCK, "h-7 w-32")} />

        {/* Duration */}
        <div className="flex flex-col gap-2">
          <div className={cn(SKELETON_BLOCK, "h-5 w-48")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={cn(SKELETON_BLOCK, "h-20")} />
            <div className={cn(SKELETON_BLOCK, "h-20")} />
          </div>
        </div>

        {/* Days */}
        <div className="flex flex-col gap-2">
          <div className={cn(SKELETON_BLOCK, "h-5 w-32")} />
          <div className={cn(SKELETON_BLOCK, "h-4 w-20")} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className={cn(SKELETON_BLOCK, "h-12")} />
            ))}
          </div>
        </div>

        {/* Times */}
        <div className="flex flex-col gap-2">
          <div className={cn(SKELETON_BLOCK, "h-5 w-40")} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={cn(SKELETON_BLOCK, "h-11")} />
            ))}
          </div>
        </div>
      </div>

      <hr className="border-seasalt-200/80" />

      {/* Your details */}
      <div className="flex flex-col gap-6">
        <div className={cn(SKELETON_BLOCK, "h-7 w-36")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={cn(SKELETON_BLOCK, "h-12")} />
          <div className={cn(SKELETON_BLOCK, "h-12")} />
        </div>
        <div className={cn(SKELETON_BLOCK, "h-12 sm:max-w-sm")} />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
          <div className={cn(SKELETON_BLOCK, "h-11")} />
          <div className={cn(SKELETON_BLOCK, "h-11")} />
        </div>
      </div>

      <hr className="border-seasalt-200/80" />

      {/* Notes */}
      <div className="flex flex-col gap-2">
        <div className={cn(SKELETON_BLOCK, "h-5 w-56")} />
        <div className={cn(SKELETON_BLOCK, "h-28")} />
      </div>

      {/* Submit */}
      <div className={cn(SKELETON_BLOCK, "h-12 w-44")} />

      <span className="sr-only">Loading available appointment times...</span>
    </div>
  );
}

/**
 * Booking page component
 * @returns React element for booking page
 */
export default async function BookingPage(): Promise<React.ReactElement> {
  // Cached settings read, so the static shell still renders ahead of the slot data.
  const identity = await getIdentity();
  return (
    <CardPage>
      <PixelEvent event="InitiateCheckout" />
      <BreadcrumbJsonLd
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Book", path: "/booking" },
        ]}
      />
      <div className="flex flex-col gap-6 sm:gap-8">
        {/* Header */}
        <section className={cn(CARD, "animate-fade-in")}>
          <h1 className="mb-3 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl">
            Request an appointment
          </h1>
          <p className="text-base text-rich-black">
            Pick a time that works for you and tell me what you need help with. I'll confirm the
            details and send you a calendar invite.
            <br />
            Prefer to call or text? Reach me on{" "}
            <PhoneLink phone={identity.phone} phoneTel={identity.phoneTel} />.
          </p>
          <p className="mt-3 text-base text-rich-black">
            Want to check the prices first?{" "}
            <Link
              href="/pricing"
              className="font-semibold whitespace-nowrap text-russian-violet underline underline-offset-2 hover:opacity-80"
            >
              See pricing
            </Link>
            .
          </p>
          <p className="mt-1 text-base text-rich-black">
            Already booked?{" "}
            <Link
              href="/booking/manage"
              className="font-semibold text-russian-violet underline underline-offset-2 hover:opacity-80"
            >
              Manage your booking
            </Link>
            .
          </p>
        </section>

        {/* Two-column: Form + Sidebar */}
        <div className="grid gap-6 sm:gap-8 lg:grid-cols-[1fr_20rem]">
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
          <aside className="sticky order-1 flex flex-col gap-6 sm:gap-8 lg:top-24 lg:order-2 lg:self-start">
            {/* How it works */}
            <div className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-200")}>
              <h2 className="mb-4 text-xl font-bold text-russian-violet sm:text-2xl">
                How it works
              </h2>
              <ol className="space-y-5">
                <li className="flex gap-3">
                  <span className={STEP_ICON}>
                    <FaClock className="text-base text-moonstone-400" aria-hidden />
                  </span>
                  <div>
                    <p className="text-base font-semibold text-rich-black">Choose length</p>
                    <p className="text-base text-rich-black/70">1 or 2 hours</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className={STEP_ICON}>
                    <FaCalendarCheck className="text-base text-moonstone-400" aria-hidden />
                  </span>
                  <div>
                    <p className="text-base font-semibold text-rich-black">Pick a time</p>
                    <p className="text-base text-rich-black/70">Day and start time</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className={STEP_ICON}>
                    <FaListCheck className="text-base text-moonstone-400" aria-hidden />
                  </span>
                  <div>
                    <p className="text-base font-semibold text-rich-black">Describe the issue</p>
                    <p className="text-base text-rich-black/70">What you need help with</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className={STEP_ICON}>
                    <FaEnvelopeOpenText className="text-base text-moonstone-400" aria-hidden />
                  </span>
                  <div>
                    <p className="text-base font-semibold text-rich-black">Get confirmed</p>
                    <p className="text-base text-rich-black/70">Calendar invite by email</p>
                  </div>
                </li>
              </ol>
            </div>

            {/* Info card */}
            <div className={cn(SOFT_CARD, "animate-slide-up animate-fill-both animate-delay-300")}>
              <p className="text-base leading-relaxed text-rich-black/80">
                <strong>Timing is flexible.</strong> Most appointments are 1 hour. Choose 2 hours if
                you have multiple issues or need more time. Actual time may be shorter or longer as
                needed.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </CardPage>
  );
}
