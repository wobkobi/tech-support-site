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
import { resolveAddress } from "@/shared/lib/normalise-address";
import { normaliseEmail, normaliseEmailOrNull } from "@/shared/lib/normalise-email";
import { isValidPhone, normalisePhone, toE164NZ } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

interface ContactPatchBody {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  /**
   * Clears the address review flags. Sent with an `address` when the operator
   * picks or types a value, and on its own to dismiss a row unchanged.
   */
  addressReviewed?: boolean;
  /** Retainer tier label, or null/"" to clear the retainer arrangement. */
  retainerTier?: string | null;
  retainerPrice?: number | null;
  retainerHours?: number | null;
  /** ISO date string (yyyy-mm-dd) or null. */
  retainerSince?: string | null;
  retainerNotes?: string | null;
  /** Operator environment notes (router, ISP, tenant); never passwords. */
  siteNotes?: string | null;
}

/**
 * PATCH /api/admin/contacts/[id]
 * Updates a contact's name, phone, address, and/or retainer arrangement in the
 * local DB, then best-effort syncs the updated contact to Google Contacts
 * (retainer fields stay local - the Google mapping doesn't carry them).
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
    const trimmedEmail = normaliseEmail(body.email);
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

  // Numeric retainer fields must be finite (NaN from an empty form field must
  // not persist); dates must parse.
  for (const key of ["retainerPrice", "retainerHours"] as const) {
    const val = body[key];
    if (val !== undefined && val !== null && (typeof val !== "number" || !Number.isFinite(val))) {
      return errorResponse(`Invalid ${key}.`, 400);
    }
  }
  if (
    body.retainerSince !== undefined &&
    body.retainerSince !== null &&
    body.retainerSince !== "" &&
    Number.isNaN(new Date(body.retainerSince).getTime())
  ) {
    return errorResponse("Invalid retainerSince date.", 400);
  }

  const updateData: Record<string, string | number | boolean | Date | string[] | null> = {};
  if (body.name !== undefined) updateData.name = body.name.trim();
  if (body.email !== undefined) updateData.email = normaliseEmailOrNull(body.email);
  if (body.phone !== undefined) updateData.phone = toE164NZ(body.phone) || null;
  // Canonicalise before storing so an address typed here matches the shape the
  // import and booking paths produce. An ambiguous or failed lookup keeps the
  // typed text - the operator has already made the call by typing it.
  if (body.address !== undefined) {
    const typed = body.address.trim() || null;
    const resolution = typed ? await resolveAddress(typed) : null;
    updateData.address = resolution?.status === "resolved" ? resolution.address : typed;
  }
  if (body.addressReviewed) {
    updateData.addressUnverified = false;
    updateData.addressCandidates = [];
  }
  if (body.retainerTier !== undefined) updateData.retainerTier = body.retainerTier?.trim() || null;
  if (body.retainerPrice !== undefined) updateData.retainerPrice = body.retainerPrice;
  if (body.retainerHours !== undefined) updateData.retainerHours = body.retainerHours;
  if (body.retainerSince !== undefined) {
    updateData.retainerSince = body.retainerSince ? new Date(body.retainerSince) : null;
  }
  if (body.retainerNotes !== undefined) {
    updateData.retainerNotes = body.retainerNotes?.trim() || null;
  }
  if (body.siteNotes !== undefined) updateData.siteNotes = body.siteNotes?.trim() || null;

  const contact = await prisma.contact.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      address: true,
      retainerTier: true,
      retainerPrice: true,
      retainerHours: true,
      retainerSince: true,
      retainerNotes: true,
      siteNotes: true,
    },
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
