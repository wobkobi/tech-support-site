// src/app/api/admin/contacts/[id]/route.ts
/**
 * @file route.ts
 * @description Admin API route for updating individual contacts.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { syncContactToGoogle } from "@/features/contacts/lib/google-contacts";
import { toE164NZ, normalizePhone, isValidPhone } from "@/shared/lib/normalize-phone";

interface ContactPatchBody {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
}

/**
 * PATCH /api/admin/contacts/[id]
 * Updates a contact's name, phone, and/or address in the local DB,
 * then best-effort syncs the updated contact to Google Contacts.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request with optional name, phone, address fields.
 * @param params - Route parameters containing the contact ID.
 * @param params.params - Promise resolving to the dynamic route params object.
 * @returns JSON with the updated contact on success, or error.
 */
export async function PATCH(
  request: NextRequest,
  params: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params.params;
  const body = (await request.json()) as ContactPatchBody;

  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (body.email !== undefined) {
    const trimmedEmail = body.email.trim().toLowerCase();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    if (trimmedEmail) {
      const dupe = await prisma.contact.findFirst({
        where: { email: trimmedEmail, id: { not: id } },
        select: { id: true },
      });
      if (dupe) {
        return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
      }
    }
  }
  if (body.phone !== undefined && body.phone.trim() && !isValidPhone(normalizePhone(body.phone))) {
    return NextResponse.json({ error: "Please enter a valid phone number." }, { status: 400 });
  }

  const updateData: Record<string, string | null> = {};
  if (body.name !== undefined) updateData.name = body.name.trim();
  if (body.email !== undefined) updateData.email = body.email.trim().toLowerCase() || null;
  if (body.phone !== undefined) updateData.phone = toE164NZ(body.phone) || null;
  if (body.address !== undefined) updateData.address = body.address.trim() || null;

  const contact = await prisma.contact.update({
    where: { id },
    data: updateData,
    select: { id: true, name: true, email: true, phone: true, address: true },
  });

  // Best-effort Google Contacts sync — never fail the request if it errors.
  try {
    await syncContactToGoogle(id);
  } catch (syncError) {
    console.error(`[api/admin/contacts/${id}] Google sync failed (non-fatal):`, syncError);
  }

  return NextResponse.json({ ok: true, contact });
}
