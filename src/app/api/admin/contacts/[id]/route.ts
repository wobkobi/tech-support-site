// src/app/api/admin/contacts/[id]/route.ts
/**
 * @description Admin API route for updating individual contacts.
 */

import {
  deleteContactFromGoogle,
  syncContactToGoogle,
} from "@/features/contacts/lib/google-contacts";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { isValidPhone, normalisePhone, toE164NZ } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

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
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params.params;
  const body = (await request.json().catch(() => null)) as ContactPatchBody | null;
  if (!body) {
    return errorResponse("Invalid request body.", 400);
  }

  // Reject unknown/malformed ids and soft-deleted contacts up front so a missing
  // row returns 404 (not a P2025 500) and a PATCH can't edit or re-sync a hidden
  // contact.
  let existing: { id: string } | null;
  try {
    existing = await prisma.contact.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
  } catch {
    // A malformed ObjectId throws P2023; treat it as not found.
    return errorResponse("Contact not found.", 404);
  }
  if (!existing) {
    return errorResponse("Contact not found.", 404);
  }

  if (body.name !== undefined && !body.name.trim()) {
    return errorResponse("Name is required.", 400);
  }
  if (body.email !== undefined) {
    const trimmedEmail = body.email.trim().toLowerCase();
    if (trimmedEmail && !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(trimmedEmail)) {
      return errorResponse("Please enter a valid email address.", 400);
    }
    if (trimmedEmail) {
      const dupe = await prisma.contact.findFirst({
        where: {
          id: { not: id },
          deletedAt: null,
          // Collide against another contact's primary OR alt emails so the same
          // address can't live as a primary on one contact and an alt on another.
          OR: [
            { email: { equals: trimmedEmail, mode: "insensitive" } },
            { altEmails: { has: trimmedEmail } },
          ],
        },
        select: { id: true },
      });
      if (dupe) {
        return errorResponse("That email is already in use.", 409);
      }
    }
  }
  if (body.phone !== undefined && body.phone.trim() && !isValidPhone(normalisePhone(body.phone))) {
    return errorResponse("Please enter a valid phone number.", 400);
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

  // Best-effort Google Contacts sync - never fail the request if it errors.
  try {
    await syncContactToGoogle(id);
  } catch (syncError) {
    console.error(`[api/admin/contacts/${id}] Google sync failed (non-fatal):`, syncError);
  }

  return NextResponse.json({ ok: true, contact });
}

/**
 * DELETE /api/admin/contacts/[id]
 * Soft-deletes a contact by stamping `deletedAt`. Soft (not hard) delete because
 * backfillContacts would otherwise re-create the contact from its still-present
 * booking on the next admin page load; the stamped row suppresses that. Removes
 * the linked Google contact best-effort. Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @param params - Route parameters containing the contact ID.
 * @param params.params - Promise resolving to the dynamic route params object.
 * @returns JSON { ok: true } on success, or error.
 */
export async function DELETE(
  request: NextRequest,
  params: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params.params;

  const contact = await prisma.contact.findUnique({
    where: { id },
    select: { id: true, googleContactId: true, deletedAt: true },
  });
  if (!contact) {
    return errorResponse("Contact not found.", 404);
  }
  if (contact.deletedAt) {
    return NextResponse.json({ ok: true, alreadyDeleted: true });
  }

  // Unlink the contact's reviews as we soft-delete, atomically. Otherwise they
  // keep a contactId pointing at a now-hidden contact, and matchReviewsToContacts
  // (which only re-homes contactId==null) would never surface them again. Nulled,
  // they show as unlinked and can re-match to a live contact.
  await prisma.$transaction([
    prisma.review.updateMany({ where: { contactId: id }, data: { contactId: null } }),
    prisma.contact.update({ where: { id }, data: { deletedAt: new Date() } }),
  ]);

  if (contact.googleContactId) {
    await deleteContactFromGoogle(contact.googleContactId);
  }

  return NextResponse.json({ ok: true });
}
