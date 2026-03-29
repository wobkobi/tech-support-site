// src/app/api/admin/contacts/backfill/route.ts
/**
 * @file route.ts
 * @description One-time backfill: upserts a Contact for every unique email in Booking and
 * ReviewRequest history.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { toE164NZ, normalizePhone } from "@/shared/lib/normalize-phone";

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
 * Scans all Bookings and ReviewRequests, and upserts a Contact for each unique email.
 * For each email, the most recent Booking or ReviewRequest is used as the source of truth.
 * Existing contacts are never overwritten — admin edits take precedence.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON with upserted count.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Build a unified map of email → contact data from all sources.
  // Sources are processed oldest-first so the most recent entry wins.

  const mergedByEmail = new Map<
    string,
    { name: string; email: string; phone: string | null; address: string | null }
  >();
  const mergedByPhone = new Map<string, { name: string; email: null; phone: string }>();

  // 1. Bookings (sorted ascending — most recent wins the Map)
  const bookings = await prisma.booking.findMany({
    orderBy: { createdAt: "asc" },
    select: { name: true, email: true, notes: true },
  });
  for (const b of bookings) {
    const { phone, address } = parseNotes(b.notes);
    mergedByEmail.set(b.email.toLowerCase(), { name: b.name, email: b.email, phone, address });
  }

  // 2. ReviewRequests — email-based and phone-only (sorted ascending — most recent wins)
  const reviewRequests = await prisma.reviewRequest.findMany({
    orderBy: { createdAt: "asc" },
    select: { name: true, email: true, phone: true },
  });
  for (const rr of reviewRequests) {
    if (rr.email) {
      const existing = mergedByEmail.get(rr.email.toLowerCase());
      mergedByEmail.set(rr.email.toLowerCase(), {
        name: rr.name,
        email: rr.email,
        // Prefer booking phone/address if we already have them from a booking record
        phone: existing?.phone ?? (rr.phone ? toE164NZ(rr.phone) || rr.phone : null),
        address: existing?.address ?? null,
      });
    } else if (rr.phone) {
      const phone = toE164NZ(rr.phone) || rr.phone;
      const normPhone = normalizePhone(phone);
      if (normPhone && !mergedByPhone.has(normPhone)) {
        mergedByPhone.set(normPhone, { name: rr.name, email: null, phone });
      }
    }
  }

  let upsertedCount = 0;
  for (const { name, email, phone, address } of mergedByEmail.values()) {
    const exists = await prisma.contact.findFirst({ where: { email } });
    if (!exists) {
      await prisma.contact.create({ data: { name, email, phone, address } });
      upsertedCount++;
    }
  }
  for (const { name, email, phone } of mergedByPhone.values()) {
    const exists = await prisma.contact.findFirst({ where: { phone } });
    if (!exists) {
      await prisma.contact.create({ data: { name, email, phone } });
      upsertedCount++;
    }
  }

  return NextResponse.json({ ok: true, upsertedCount });
}
