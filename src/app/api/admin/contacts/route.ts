// src/app/api/admin/contacts/route.ts
/**
 * @file route.ts
 * @description Admin API for listing and creating contacts.
 */

import { findOrCreateContactByEmail } from "@/features/contacts/lib/find-or-create";
import { syncContactToGoogle } from "@/features/contacts/lib/google-contacts";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
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

  const email = body.email.trim().toLowerCase();
  if (!email.includes("@")) {
    return errorResponse("Invalid email", 400);
  }

  const phoneE164 = body.phone ? toE164NZ(body.phone) || null : null;

  const { contact, created } = await findOrCreateContactByEmail(email, {
    name: body.name.trim(),
    phone: phoneE164,
    address: body.address?.trim() || null,
    googleContactId: body.googleContactId?.trim() || null,
  });

  if (!created) {
    return NextResponse.json({ ok: true, created: false, contact });
  }

  // Best-effort: push to Google Contacts so it appears on the operator's phone.
  void syncContactToGoogle(contact.id).catch((err) => {
    console.error("[admin/contacts] syncContactToGoogle failed:", err);
  });

  return NextResponse.json({ ok: true, created: true, contact }, { status: 201 });
}
