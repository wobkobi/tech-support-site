// src/app/api/booking/ics/route.ts
// Token-gated .ics download (cancel-token auth) - never shared-cacheable, and
// must not leak data for a cancelled slot.

import {
  buildAppointmentDescription,
  combineUnitAndAddress,
  parseBookingNotes,
} from "@/features/booking/lib/booking";
import { buildIcs } from "@/features/booking/lib/ics";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Streams a single-event `.ics` for the booking identified by `?token=`.
 * @param request - The incoming request.
 * @returns The calendar file, or 404 when the token matches nothing usable.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const token = request.nextUrl.searchParams.get("token")?.trim();
  if (!token) return new Response("Missing token", { status: 400 });

  const booking = await prisma.booking
    .findFirst({
      where: { cancelToken: token },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        address: true,
        unit: true,
        meetingType: true,
        notes: true,
        status: true,
        rescheduleCount: true,
      },
    })
    .catch(() => null);

  // Same 404 for "no such token" and "cancelled": a cancelled booking has no
  // appointment to add, and a distinct response would confirm the token exists.
  if (!booking || booking.status === "cancelled") {
    return new Response("Not found", { status: 404 });
  }

  const identity = await getIdentity();
  const site = getSiteUrl();
  // Rejoin in the stored NZ form ("12/160 Kepa Road"), not a comma join - a
  // unit separated by a comma reads as a different address to a map lookup.
  const where = combineUnitAndAddress(booking.unit ?? "", booking.address ?? "");
  const location = booking.meetingType === "remote" || !where ? undefined : where;
  const manageUrl = `${site}/booking/edit?token=${encodeURIComponent(token)}`;

  // Only the customer's own words - the rest of the notes blob is time /
  // address / meeting-type metadata that already has its own ICS fields.
  const { userNotes } = parseBookingNotes(booking.notes);

  const description = buildAppointmentDescription({
    company: identity.company,
    phone: identity.phone,
    email: identity.email,
    isRemote: booking.meetingType === "remote",
    userNotes,
    manageUrl,
    cancelUrl: `${site}/booking/cancel?token=${encodeURIComponent(token)}`,
  });

  const ics = buildIcs({
    // The booking id, so a reschedule updates the same calendar entry.
    uid: `booking-${booking.id}@tothepointtech.co.nz`,
    start: booking.startAt,
    end: booking.endAt,
    summary: `${identity.company} appointment`,
    description,
    location,
    url: manageUrl,
    // Rises on every reschedule, which is what makes clients accept the update.
    sequence: booking.rescheduleCount,
    organiserEmail: identity.email,
  });

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="appointment.ics"',
      // Token-bearing, per-booking response: never let a shared cache hold it.
      "Cache-Control": "private, no-store",
    },
  });
}
