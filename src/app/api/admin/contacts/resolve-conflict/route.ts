// src/app/api/admin/contacts/resolve-conflict/route.ts
/**
 * @file route.ts
 * @description Resolves a contact conflict by applying a chosen value to both the contact
 * and the source record (ReviewRequest, Booking, or Review).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { toE164NZ } from "@/shared/lib/normalize-phone";

interface ResolveBody {
  /** Local contact ID to update. */
  contactId: string;
  /** Source record ID to write back to. */
  sourceId: string;
  /** Source type - determines which table to update. */
  source: "ReviewRequest" | "Booking" | "Review";
  /** Fields and their chosen values. */
  name?: string;
  phone?: string;
}

/**
 * POST /api/admin/contacts/resolve-conflict
 * Applies the chosen value for each conflicting field to both the local Contact
 * and the originating source record. This keeps both sides in sync regardless of
 * which value was chosen.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON { ok: true } on success or an error response.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as ResolveBody;
  const { contactId, sourceId, source, name, phone } = body;

  if (!contactId || !sourceId || !source) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  const contactUpdate: Record<string, string | null> = {};
  if (name !== undefined) contactUpdate.name = name.trim();
  if (phone !== undefined) contactUpdate.phone = toE164NZ(phone) || phone.trim() || null;

  try {
    await prisma.contact.update({ where: { id: contactId }, data: contactUpdate });

    if (source === "ReviewRequest") {
      const rrUpdate: Record<string, string | null> = {};
      if (name !== undefined) rrUpdate.name = name.trim();
      if (phone !== undefined) rrUpdate.phone = toE164NZ(phone) || phone.trim() || null;
      if (Object.keys(rrUpdate).length > 0) {
        await prisma.reviewRequest.update({ where: { id: sourceId }, data: rrUpdate });
      }
    } else if (source === "Booking") {
      const bookingUpdate: Record<string, string | null> = {};
      if (name !== undefined) bookingUpdate.name = name.trim();
      if (phone !== undefined) bookingUpdate.phone = toE164NZ(phone) || phone.trim() || null;
      if (Object.keys(bookingUpdate).length > 0) {
        await prisma.booking.update({ where: { id: sourceId }, data: bookingUpdate });
      }
    } else if (source === "Review") {
      // Reviews store name as firstName/lastName - only name conflicts arise from Reviews.
      if (name !== undefined) {
        const parts = name.trim().split(/\s+/);
        const firstName = parts.slice(0, -1).join(" ") || parts[0] || null;
        const lastName = parts.length > 1 ? parts[parts.length - 1] : null;
        await prisma.review.update({
          where: { id: sourceId },
          data: { firstName, lastName },
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin/contacts/resolve-conflict] POST error:", error);
    return NextResponse.json({ error: "Failed to resolve conflict." }, { status: 500 });
  }
}
