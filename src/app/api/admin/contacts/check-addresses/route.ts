// src/app/api/admin/contacts/check-addresses/route.ts
// On-demand sweep re-geocoding every contact address: tidies clean single matches and flags
// unconfident ones (one Geocoding call per contact).

import { UNRESOLVED_CONFLICT_FILTER } from "@/features/contacts/lib/contact-conflicts";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { addressCovers, resolveAddress } from "@/shared/lib/normalise-address";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/contacts/check-addresses - Re-checks every address and updates the review
 * flags. A single confident match replaces the stored text when it says everything the old
 * text did, so a unit or suburb the geocoder dropped never goes missing; the next sync sends
 * the tidied form to Google. An address with an open conflict keeps its text.
 * @param request - Incoming request.
 * @returns JSON `{ ok: true, checked, flagged, tidied }`, or an error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const [contacts, openConflicts] = await Promise.all([
    prisma.contact.findMany({
      where: { address: { not: null }, deletedAt: null },
      select: {
        id: true,
        address: true,
        addressUnverified: true,
        addressCandidates: true,
        updatedAt: true,
        lastSyncedAt: true,
      },
    }),
    prisma.contactConflict.findMany({
      where: { field: "address", ...UNRESOLVED_CONFLICT_FILTER },
      select: { contactId: true },
    }),
  ]);
  const disputed = new Set(openConflicts.map((c) => c.contactId));

  let checked = 0;
  let flagged = 0;
  let tidied = 0;

  for (const contact of contacts) {
    if (!contact.address) continue;

    const resolution = await resolveAddress(contact.address);
    // A failed lookup says nothing about the address; leave the row alone.
    if (resolution.status === "skipped") continue;
    checked++;

    const unverified = resolution.status !== "resolved";
    const candidates = resolution.status === "ambiguous" ? resolution.candidates : [];
    if (unverified) flagged++;

    const tidy =
      resolution.status === "resolved" &&
      resolution.address !== contact.address &&
      !disputed.has(contact.id) &&
      addressCovers(resolution.address, contact.address)
        ? resolution.address
        : null;
    if (tidy) tidied++;

    // Skip unchanged rows so updatedAt stays put.
    const sameFlags =
      contact.addressUnverified === unverified &&
      contact.addressCandidates.length === candidates.length &&
      contact.addressCandidates.every((value, i) => value === candidates[i]);
    if (sameFlags && !tidy) continue;

    // A flag-only write re-stamps a clean row so it stays clean; a tidied address leaves the
    // row dirty so the next sync pushes it.
    const wasClean = contact.lastSyncedAt !== null && contact.updatedAt <= contact.lastSyncedAt;
    const stampedAt = new Date();

    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        addressUnverified: unverified,
        addressCandidates: candidates,
        ...(tidy
          ? { address: tidy }
          : wasClean
            ? { lastSyncedAt: stampedAt, updatedAt: stampedAt }
            : {}),
      },
    });
  }

  return okResponse({ checked, flagged, tidied });
}
