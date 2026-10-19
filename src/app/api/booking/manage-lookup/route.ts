// src/app/api/booking/manage-lookup/route.ts
// Find-my-booking: emails change/cancel links for upcoming appointments. The response
// is identical whether or not the address matched, so it can't enumerate bookers.

import { sendBookingManageLinksEmail } from "@/features/reviews/lib/email-booking";
import { errorResponse } from "@/shared/lib/api-response";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { prisma } from "@/shared/lib/prisma";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Said back for every well-formed request, match or not. */
const UNIFORM_MESSAGE =
  "If we found an upcoming booking for that email address, we've sent the change and cancel links to it. Please check your inbox (and your spam folder).";

/**
 * POST /api/booking/manage-lookup - body `{ email }`.
 * @param request - Incoming request.
 * @returns The same acknowledgement regardless of whether a booking matched.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Tighter than the booking form: this sends mail on a bare email address.
  const limited = rateLimitOrReject(request, "manage-lookup", 3, 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as { email?: unknown };
  const email = typeof body.email === "string" ? normaliseEmail(body.email) : "";
  // A malformed address leaks nothing about who has booked, so report it.
  if (!email || !email.includes("@") || email.length > 200) {
    return errorResponse("Enter a valid email address.", 400);
  }

  try {
    const bookings = await prisma.booking.findMany({
      where: {
        email: { equals: email, mode: "insensitive" },
        status: "confirmed",
        startAt: { gte: new Date() },
      },
      orderBy: { startAt: "asc" },
      select: { startAt: true, cancelToken: true },
      // Bounds the email size.
      take: 10,
    });

    if (bookings.length > 0) {
      await sendBookingManageLinksEmail(email, bookings);
    }
  } catch (error) {
    // Swallow: a distinct failure response would be an enumeration signal.
    console.error("[booking/manage-lookup] Lookup or send failed:", error);
  }

  return NextResponse.json({ ok: true, message: UNIFORM_MESSAGE });
}
