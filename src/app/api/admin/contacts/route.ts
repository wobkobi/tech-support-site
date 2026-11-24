// src/app/api/admin/contacts/route.ts
// Admin API for listing and creating contacts.

import {
  type ContactSeed,
  findOrCreateContactByEmail,
  findOrCreateContactByPhone,
} from "@/features/contacts/lib/find-or-create";
import {
  pushPhoneOnlyContactToGoogle,
  syncContactToGoogle,
} from "@/features/contacts/lib/google-contacts";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { resolveAddress } from "@/shared/lib/normalise-address";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { normaliseContactPhone, storedPhoneForms, toE164NZ } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/contacts
 * Returns all contacts ordered by newest first.
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
 * Find-or-creates a Contact by email (attaching it to a `googleContactId` match), or by mobile
 * for a client with no email, then best-effort pushes it to Google.
 * @param request - Incoming request with { name, email?, phone?, address?, company?,
 *   googleContactId? }; an email or a phone is required.
 * @returns JSON { ok, created, emailAttached, contact }.
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
    company?: string | null;
    googleContactId?: string | null;
  } | null;

  if (!body || !body.name?.trim()) {
    return errorResponse("Name is required", 400);
  }

  const email = normaliseEmail(body.email);
  const phoneE164 = body.phone ? toE164NZ(body.phone) || null : null;
  if (!email && !phoneE164) {
    return errorResponse("Add an email or a mobile number", 400);
  }
  if (email && !email.includes("@")) {
    return errorResponse("Invalid email", 400);
  }

  // Canonicalise a typed address; an unconfident match keeps the text and flags it for review.
  const rawAddress = body.address?.trim() || null;
  const resolution = rawAddress ? await resolveAddress(rawAddress) : null;
  const address = resolution?.status === "resolved" ? resolution.address : rawAddress;
  const addressUnverified =
    resolution?.status === "ambiguous" || resolution?.status === "unresolved";
  const addressCandidates = resolution?.status === "ambiguous" ? resolution.candidates : [];

  const seed: ContactSeed = {
    name: body.name.trim(),
    phone: phoneE164,
    address,
    addressUnverified,
    addressCandidates,
    company: body.company?.trim() || null,
    googleContactId: body.googleContactId?.trim() || null,
  };
  // A client with only a mobile matches on it; a landline gets its own contact.
  const byPhone = Boolean(phoneE164 && !email);
  const found =
    phoneE164 && byPhone
      ? await findOrCreateContactByPhone(phoneE164, seed, { mobileOnly: true })
      : await findOrCreateContactByEmail(email, seed);
  const { contact, created, emailAttached } = found;

  // Two saves at once both miss and both create. Recheck now: the oldest live match wins and
  // the newer twin is removed, so both requests answer with the same contact.
  if (created) {
    const key = byPhone ? normaliseContactPhone(phoneE164) : null;
    const forms = key ? storedPhoneForms(key) : [];
    const oldest = await prisma.contact.findFirst({
      where: {
        deletedAt: null,
        OR: byPhone
          ? [{ phone: { in: forms } }, { altPhones: { hasSome: forms } }]
          : [{ email: { equals: email, mode: "insensitive" } }, { altEmails: { has: email } }],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (oldest && oldest.id !== contact.id) {
      await prisma.contact.delete({ where: { id: contact.id } });
      return NextResponse.json({ ok: true, created: false, contact: oldest });
    }
  }

  if (!created && !emailAttached) {
    return NextResponse.json({ ok: true, created: false, contact });
  }

  // Push to Google; awaited because Vercel freezes after the response, but best-effort.
  try {
    if (contact.email) await syncContactToGoogle(contact.id);
    else await pushPhoneOnlyContactToGoogle(contact.id);
  } catch (err) {
    console.error("[admin/contacts] Google Contacts push failed:", err);
  }

  return NextResponse.json(
    { ok: true, created, emailAttached: Boolean(emailAttached), contact },
    { status: created ? 201 : 200 },
  );
}
