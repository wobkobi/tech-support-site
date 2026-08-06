// src/app/api/admin/contacts/check-addresses/route.ts
/**
 * @description Admin sweep that re-geocodes every stored contact address and
 * flags the ones that don't resolve to a single confident Auckland match. The
 * import path only geocodes addresses that changed, so rows that were already
 * wrong never get re-checked - this is how they surface. On demand rather than
 * on the cron: it costs one Geocoding call per contact.
 */

import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { resolveAddress } from "@/shared/lib/normalise-address";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// One Geocoding call per contact, run sequentially - needs the full ceiling.
export const maxDuration = 300;

/**
 * POST /api/admin/contacts/check-addresses - Re-checks every contact address
 * and updates the review flags. Only ever flags; never rewrites an address, so
 * the sweep cannot quietly reformat addresses the operator didn't ask it to
 * touch. Requires admin auth.
 * @param request - Incoming request.
 * @returns JSON `{ ok: true, checked, flagged }`, or an error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const contacts = await prisma.contact.findMany({
    where: { address: { not: null }, deletedAt: null },
    select: {
      id: true,
      address: true,
      addressUnverified: true,
      addressCandidates: true,
      updatedAt: true,
      lastSyncedAt: true,
    },
  });

  let checked = 0;
  let flagged = 0;

  for (const contact of contacts) {
    if (!contact.address) continue;

    const resolution = await resolveAddress(contact.address);
    // A failed lookup says nothing about the address - leave the row alone
    // rather than flagging it or clearing a flag that still applies.
    if (resolution.status === "skipped") continue;
    checked++;

    const unverified = resolution.status !== "resolved";
    const candidates = resolution.status === "ambiguous" ? resolution.candidates : [];
    if (unverified) flagged++;

    // Skip the write when the flags already say this, so a rerun doesn't touch
    // updatedAt on rows that haven't changed.
    const sameFlags =
      contact.addressUnverified === unverified &&
      contact.addressCandidates.length === candidates.length &&
      contact.addressCandidates.every((value, i) => value === candidates[i]);
    if (sameFlags) continue;

    // Raising a flag bumps updatedAt, which would mark the row locally changed
    // and re-push an address that never actually changed. Re-stamp lastSyncedAt
    // to match - but only for rows that were already clean, since re-stamping a
    // dirty row would swallow a genuine pending push.
    const wasClean = contact.lastSyncedAt !== null && contact.updatedAt <= contact.lastSyncedAt;
    const stampedAt = new Date();

    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        addressUnverified: unverified,
        addressCandidates: candidates,
        ...(wasClean ? { lastSyncedAt: stampedAt, updatedAt: stampedAt } : {}),
      },
    });
  }

  return okResponse({ checked, flagged });
}
