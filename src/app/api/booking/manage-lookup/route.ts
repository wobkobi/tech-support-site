// src/app/api/booking/manage-lookup/route.ts
/**
 * @description Find-my-booking: emails someone the change/cancel links for
 * their upcoming appointments. The response is deliberately identical whether
 * or not the address matched, so this can't be used to test which email
 * addresses have booked.
 */

import { sendBookingManageLinksEmail } from "@/features/reviews/lib/email";
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
  // Tighter than the booking form: this one sends mail on a bare email address,
  // so it is the more attractive thing to hammer.
  const limited = rateLimitOrReject(request, "manage-lookup", 3, 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  // A malformed address is the one case worth reporting - it's the user's own
  // typo, and saying so leaks nothing about who has booked.
  if (!email || !email.includes("@") || email.length > 200) {
    return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
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
      // A generous cap: nobody legitimately has more upcoming than this, and it
      // bounds the email size.
      take: 10,
    });

    if (bookings.length > 0) {
      await sendBookingManageLinksEmail(email, bookings);
    }
  } catch (error) {
    // Swallow: reporting a lookup/send failure differently would reintroduce
    // the enumeration signal this endpoint exists to avoid.
    console.error("[booking/manage-lookup] Lookup or send failed:", error);
  }

  return NextResponse.json({ ok: true, message: UNIFORM_MESSAGE });
}
