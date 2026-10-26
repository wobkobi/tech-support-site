// src/app/api/admin/contacts/conflicts/[id]/route.ts
// Admin endpoint to resolve a ContactConflict: writes the winning value to the Contact,
// marks it resolved, and re-syncs to Google.

import { syncContactToGoogle } from "@/features/contacts/lib/google-contacts";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/contacts/conflicts/[id]
 * Body: `{ winner: "site" | "google" | "custom", customValue?: string }`.
 * - winner "site" - keeps the site value, marks resolved, pushes to Google.
 * - winner "google" - copies Google value to site contact, marks resolved.
 * - winner "custom" - writes `customValue` to site, marks resolved, pushes.
 * @param request - Incoming request.
 * @param ctx - Route ctx with the conflict id.
 * @param ctx.params - Resolved Next.js dynamic route params.
 * @returns JSON with ok flag or error.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    winner?: unknown;
    customValue?: unknown;
  };
  const winner = body.winner;
  const customValue = typeof body.customValue === "string" ? body.customValue : null;

  if (winner !== "site" && winner !== "google" && winner !== "custom") {
    return errorResponse("winner must be 'site' | 'google' | 'custom'", 400);
  }
  if (winner === "custom" && !customValue) {
    return errorResponse("customValue is required when winner is 'custom'", 400);
  }

  const conflict = await prisma.contactConflict.findUnique({ where: { id } });
  if (!conflict || conflict.resolvedAt) {
    return errorResponse("Conflict not found or already resolved", 404);
  }

  // Decide the chosen value
  const chosenValue =
    winner === "site"
      ? conflict.siteValue
      : winner === "google"
        ? conflict.googleValue
        : customValue;

  // conflict.field is the ContactField enum: name, email or address.
  const field = conflict.field;

  // Contact.name is required, so a blank name would make Prisma throw.
  if (field === "name" && !chosenValue?.trim()) {
    return errorResponse("A name value is required to resolve this conflict.", 400);
  }

  try {
    await prisma.contact.update({
      where: { id: conflict.contactId },
      // Clearing lastSyncedAt forces the chosen value to push to Google.
      data: { [field]: chosenValue, lastSyncedAt: null },
    });

    await prisma.contactConflict.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });

    // Push the chosen value to Google; syncContactToGoogle never throws.
    await syncContactToGoogle(conflict.contactId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/contacts/conflicts/id] POST error:", err);
    return errorResponse("Failed to resolve conflict", 500);
  }
}
