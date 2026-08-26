// src/app/api/admin/contacts/route.ts
/**
 * @description Admin API for listing and creating contacts.
 */

import { findOrCreateContactByEmail } from "@/features/contacts/lib/find-or-create";
import { syncContactToGoogle } from "@/features/contacts/lib/google-contacts";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { resolveAddress } from "@/shared/lib/normalise-address";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { toE164NZ } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/contacts
 * Returns all contacts ordered by newest first.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON with contacts array.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const contacts = await prisma.contact.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      address: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ ok: true, contacts });
}

/**
 * POST /api/admin/contacts
 * Find-or-creates a Contact by email. On create, fires a best-effort sync to
 * Google Contacts.
 * @param request - Incoming request with { name, email, phone?, address?, googleContactId? }.
 * @returns JSON { ok, created, contact }.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    email?: string;
    phone?: string | null;
    address?: string | null;
    googleContactId?: string | null;
  } | null;

  if (!body || !body.name?.trim() || !body.email?.trim()) {
    return errorResponse("Name and email are required", 400);
  }

  const email = normaliseEmail(body.email);
  if (!email.includes("@")) {
    return errorResponse("Invalid email", 400);
  }

  const phoneE164 = body.phone ? toE164NZ(body.phone) || null : null;

  // Google-canonicalise a typed address (unambiguous matches only - see
  // resolveAddress), keeping the typed value when there's no single confident
  // match and flagging it so it shows in the address review queue.
  const rawAddress = body.address?.trim() || null;
  const resolution = rawAddress ? await resolveAddress(rawAddress) : null;
  const address = resolution?.status === "resolved" ? resolution.address : rawAddress;
  const addressUnverified =
    resolution?.status === "ambiguous" || resolution?.status === "unresolved";
  const addressCandidates = resolution?.status === "ambiguous" ? resolution.candidates : [];

  const { contact, created } = await findOrCreateContactByEmail(email, {
    name: body.name.trim(),
    phone: phoneE164,
    address,
    addressUnverified,
    addressCandidates,
    googleContactId: body.googleContactId?.trim() || null,
  });

  if (!created) {
    return NextResponse.json({ ok: true, created: false, contact });
  }

  // Push to Google Contacts so it appears on the operator's phone. Awaited, not
  // detached: Vercel freezes the instance once the response is sent, so a `void`
  // call would often never reach Google and the contact would stay site-only
  // until the next sync cron. Still best-effort - a Google hiccup must not fail
  // the create that already committed.
  try {
    await syncContactToGoogle(contact.id);
  } catch (err) {
    console.error("[admin/contacts] syncContactToGoogle failed:", err);
  }

  return NextResponse.json({ ok: true, created: true, contact }, { status: 201 });
}
