// src/app/api/admin/contacts/resolve-conflict/route.ts
// Resolves a contact conflict by writing the chosen value to the contact and its source record.

import { splitName } from "@/features/contacts/lib/split-name";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { normaliseContactPhone } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

interface ResolveBody {
  /** Local contact ID to update. */
  contactId: string;
  /** Source record ID to write back to. */
  sourceId: string;
  /** Source type - determines which table to update. */
  source: "Booking" | "Review";
  /** Fields and their chosen values. */
  name?: string;
  phone?: string;
}

/**
 * POST /api/admin/contacts/resolve-conflict
 * Applies each chosen value to both the Contact and its source record.
 * @param request - Incoming request.
 * @returns JSON { ok: true } on success or an error response.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const body = (await request.json().catch(() => null)) as ResolveBody | null;
  if (!body) {
    return errorResponse("Invalid request body.", 400);
  }
  const { contactId, sourceId, source, name, phone } = body;

  if (!contactId || !sourceId || !source) {
    return errorResponse("Missing required fields.", 400);
  }
  if (source !== "Booking" && source !== "Review") {
    // An unknown source would skip the source write-back.
    return errorResponse("source must be 'Booking' or 'Review'.", 400);
  }

  const normalisedPhone =
    phone !== undefined ? normaliseContactPhone(phone) || phone.trim() || null : null;

  const contactUpdate: Record<string, string | null> = {};
  if (name !== undefined) contactUpdate.name = name.trim();
  if (phone !== undefined) contactUpdate.phone = normalisedPhone;

  try {
    // Contact and source move together.
    const writes: Prisma.PrismaPromise<unknown>[] = [
      prisma.contact.update({ where: { id: contactId }, data: contactUpdate }),
    ];

    if (source === "Booking") {
      const bookingUpdate: Record<string, string | null> = {};
      if (name !== undefined) bookingUpdate.name = name.trim();
      if (phone !== undefined) bookingUpdate.phone = normalisedPhone;
      if (Object.keys(bookingUpdate).length > 0) {
        writes.push(prisma.booking.update({ where: { id: sourceId }, data: bookingUpdate }));
      }
    } else if (source === "Review") {
      // Reviews store name as firstName/lastName - only name conflicts arise from Reviews.
      if (name !== undefined) {
        const { givenName, familyName } = splitName(name);
        writes.push(
          prisma.review.update({
            where: { id: sourceId },
            data: { firstName: givenName || null, lastName: familyName || null },
          }),
        );
      }
    }

    await prisma.$transaction(writes);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin/contacts/resolve-conflict] POST error:", error);
    return errorResponse("Failed to resolve conflict.", 500);
  }
}
