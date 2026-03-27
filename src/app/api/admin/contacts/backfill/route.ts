// src/app/api/admin/contacts/backfill/route.ts
/**
 * @file route.ts
 * @description One-time backfill: upserts a Contact for every unique email in Booking history.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

/**
 * Parse phone and address from structured booking notes.
 * @param notes - Raw booking notes string.
 * @returns Parsed phone and address fields.
 */
function parseNotes(notes: string | null): { phone: string | null; address: string | null } {
  if (!notes) return { phone: null, address: null };
  const phone = notes.match(/Phone:\s*(.+)/i)?.[1]?.trim() || null;
  const address = notes.match(/Address:\s*(.+)/i)?.[1]?.trim() || null;
  return { phone, address };
}

/**
 * POST /api/admin/contacts/backfill
 * Scans all bookings and upserts a Contact for each unique email,
 * using the most recent booking per email as the source of truth.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON with upserted count.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Sorted ascending so the last entry per email (most recent) wins the Map
  const bookings = await prisma.booking.findMany({
    orderBy: { createdAt: "asc" },
    select: { name: true, email: true, notes: true },
  });

  const byEmail = new Map<string, { name: string; email: string; notes: string | null }>();
  for (const b of bookings) {
    byEmail.set(b.email, b);
  }

  let upsertedCount = 0;
  for (const { name, email, notes } of byEmail.values()) {
    const { phone, address } = parseNotes(notes);
    await prisma.contact.upsert({
      where: { email },
      create: { name, email, phone, address },
      // Never overwrite an existing contact — admin edits are the source of truth.
      update: {},
    });
    upsertedCount++;
  }

  return NextResponse.json({ ok: true, upsertedCount });
}
