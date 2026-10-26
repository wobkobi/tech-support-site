// src/app/api/booking/contact-lookup/route.ts
// Looks up a returning customer by email AND phone so the booking form can pre-fill
// their name and address. An email alone never returns anyone's details.

import { parseString } from "@/features/business/lib/validation";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { normaliseContactPhone, validatePhone } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/booking/contact-lookup
 * Name and address for the one live contact matching both the email and the phone.
 * POST keeps both out of request-path logs; no match, a phone mismatch and two
 * matches all get the same 404, so a probe learns nothing from the reply.
 * @param request - Incoming request with a JSON `{ email, phone }` body.
 * @returns JSON `{ ok, name, address }` or `{ ok: false }`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "contact-lookup", 3, 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    phone?: unknown;
  } | null;
  const email = normaliseEmail(parseString(body?.email));
  const rawPhone = parseString(body?.phone) ?? "";
  const phoneKey =
    validatePhone(rawPhone, { nzOnly: true }).result === "ok"
      ? normaliseContactPhone(rawPhone)
      : null;
  if (!email || !email.includes("@") || !phoneKey) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const candidates = await prisma.contact.findMany({
    where: {
      OR: [{ email: { equals: email, mode: "insensitive" } }, { altEmails: { has: email } }],
      deletedAt: null,
    },
    select: { name: true, phone: true, altPhones: true, address: true },
  });
  const matches = candidates.filter((c) =>
    [c.phone, ...c.altPhones].some((p) => normaliseContactPhone(p) === phoneKey),
  );

  const [contact] = matches;
  if (!contact || matches.length > 1) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  return NextResponse.json({ ok: true, name: contact.name, address: contact.address });
}
