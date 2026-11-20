// src/app/admin/(shell)/travel-alerts/page.tsx
// Travel alerts page: whether the phone is reporting, when each check last ran, recent alerts,
// and the running-late and morning-summary settings.

import { type AlertRow, TravelAlertsView } from "@/features/admin/components/TravelAlertsView";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { readLastRuns, readPhoneLocation } from "@/features/calendar/lib/running-late.server";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Travel alerts - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin Travel alerts page.
 * @returns Travel alerts page element.
 */
export default async function TravelAlertsPage(): Promise<React.ReactElement> {
  await requireAdminAuth();

  const [settings, location, lastRuns, alerts, deviceCount, h] = await Promise.all([
    getSettings(),
    readPhoneLocation(),
    readLastRuns(),
    prisma.runningLateAlert.findMany({ orderBy: { sentAt: "desc" }, take: 10 }),
    prisma.pushDevice.count(),
    headers(),
  ]);

  // Name each booking alert; calendar-only events and summaries keep a generic label.
  const bookingIds = alerts
    .map((a) => (a.key.startsWith("booking:") ? a.key.slice("booking:".length) : null))
    .filter((id): id is string => id !== null && /^[a-f0-9]{24}$/.test(id));
  const bookings = bookingIds.length
    ? await prisma.booking.findMany({
        where: { id: { in: bookingIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(bookings.map((b) => [b.id, b.name]));

  const alertRows: AlertRow[] = alerts.map((a) => {
    const [kind, id] = a.key.split(":", 2);
    let label = "Calendar job";
    if (kind === "summary") label = "Morning summary";
    else if (kind === "booking") label = nameById.get(id ?? "") ?? "Booking";
    return {
      id: a.id,
      label,
      summary: kind === "summary",
      lateMin: a.lateMin,
      jobStartAt: a.jobStartAt.toISOString(),
      sentAt: a.sentAt.toISOString(),
    };
  });

  const host = h.get("host") ?? "www.tothepoint.co.nz";
  const proto = host.startsWith("localhost") ? "http" : "https";

  return (
    <>
      <PageHeader
        title="Travel alerts"
        description="A push when traffic will make you late for a customer job, and a 7am list of the day's jobs. Your phone's location comes from the OwnTracks app."
      />
      <TravelAlertsView
        initial={settings.comms}
        defaults={DEFAULT_SETTINGS.comms}
        location={
          location
            ? {
                lat: location.lat,
                lng: location.lng,
                accuracyM: location.accuracyM,
                at: location.at.toISOString(),
              }
            : null
        }
        lastRuns={lastRuns}
        alerts={alertRows}
        deviceCount={deviceCount}
        secretSet={Boolean(process.env.OWNTRACKS_SECRET)}
        pushConfigured={Boolean(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
        )}
        ownTracksUrl={`${proto}://${host}/api/location/owntracks`}
      />
    </>
  );
}
