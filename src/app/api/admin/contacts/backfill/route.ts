// src/app/api/admin/contacts/backfill/route.ts
/**
 * @file route.ts
 * @description One-time backfill: upserts a Contact for every unique email in
 * Booking history. The standalone ReviewRequest model was retired; bookings
 * are the only remaining seed for backfill.
 */

import { findOrCreateContactByEmail } from "@/features/contacts/lib/find-or-create";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { toE164NZ } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * Parse phone and address from structured booking notes.
 * @param notes - Raw booking notes string.
 * @returns Parsed phone and address fields.
 */
function parseNotes(notes: string | null): { phone: string | null; address: string | null } {
  if (!notes) return { phone: null, address: null };
  const rawPhone = notes.match(/Phone:\s*(.+)/i)?.[1]?.trim() || null;
  const phone = rawPhone ? toE164NZ(rawPhone) || rawPhone : null;
  const address = notes.match(/Address:\s*(.+)/i)?.[1]?.trim() || null;
  return { phone, address };
}

/**
 * POST /api/admin/contacts/backfill
 * Scans all Bookings and upserts a Contact for each unique email. For each
 * email, the most recent Booking is used as the source of truth. Existing
 * contacts are never overwritten - admin edits take precedence.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON with upserted count.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const mergedByEmail = new Map<
    string,
    { name: string; email: string; phone: string | null; address: string | null }
  >();

  // Bookings sorted ascending - most recent overwrites earlier entries in the Map.
  const bookings = await prisma.booking.findMany({
    orderBy: { createdAt: "asc" },
    select: { name: true, email: true, notes: true },
  });
  for (const b of bookings) {
    const { phone, address } = parseNotes(b.notes);
    mergedByEmail.set(b.email.toLowerCase(), { name: b.name, email: b.email, phone, address });
  }

  let upsertedCount = 0;
  for (const { name, email, phone, address } of mergedByEmail.values()) {
    const { created } = await findOrCreateContactByEmail(email, { name, phone, address });
    if (created) upsertedCount++;
  }

  return NextResponse.json({ ok: true, upsertedCount });
}
