// src/app/api/booking/contact-lookup/route.ts
// Looks up a contact by email so the booking form can pre-fill name/phone/address.

import { normaliseEmail } from "@/shared/lib/normalise-email";
import { prisma } from "@/shared/lib/prisma";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/booking/contact-lookup?email=<email>
 * Name, phone and address for a known email. Exposes PII, so a tight per-IP
 * rate limit blunts enumeration.
 * @param request - Incoming request.
 * @returns JSON with contact fields or not-found response.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "contact-lookup", 3, 60_000);
  if (limited) return limited;

  const email = normaliseEmail(request.nextUrl.searchParams.get("email"));
  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const contact = await prisma.contact.findFirst({
    where: {
      OR: [{ email: { equals: email, mode: "insensitive" } }, { altEmails: { has: email } }],
      deletedAt: null,
    },
    select: { name: true, phone: true, address: true },
  });

  if (!contact) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    name: contact.name,
    phone: contact.phone,
    address: contact.address,
  });
}
