// src/app/api/booking/contact-lookup/route.ts
/**
 * @file route.ts
 * @description Looks up a contact by email so the booking form can pre-fill name/phone/address.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";

/**
 * GET /api/booking/contact-lookup?email=<email>
 * Returns name, phone, and address for a known contact email.
 * Returns 404 (ok: false) if not found - never exposes other contact fields.
 * @param request - Incoming request.
 * @returns JSON with contact fields or not-found response.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const contact = await prisma.contact.findFirst({
    where: { email },
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
