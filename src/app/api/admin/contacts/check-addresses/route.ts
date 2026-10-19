// src/app/api/admin/contacts/check-addresses/route.ts
// On-demand sweep re-geocoding every contact address and flagging unconfident matches
// (one Geocoding call per contact).

import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { resolveAddress } from "@/shared/lib/normalise-address";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/contacts/check-addresses - Re-checks every address and updates the
 * review flags; never rewrites an address.
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
    // A failed lookup says nothing about the address; leave the row alone.
    if (resolution.status === "skipped") continue;
    checked++;

    const unverified = resolution.status !== "resolved";
    const candidates = resolution.status === "ambiguous" ? resolution.candidates : [];
    if (unverified) flagged++;

    // Skip unchanged rows so updatedAt stays put.
    const sameFlags =
      contact.addressUnverified === unverified &&
      contact.addressCandidates.length === candidates.length &&
      contact.addressCandidates.every((value, i) => value === candidates[i]);
    if (sameFlags) continue;

    // Re-stamp lastSyncedAt on clean rows so the flag write doesn't mark them dirty.
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
