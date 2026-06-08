// src/app/api/admin/contacts/conflicts/[id]/route.ts
/**
 * @file route.ts
 * @description Admin endpoint to resolve a ContactConflict by picking a
 * winner (site / google / custom). Writes the chosen value to the site
 * Contact row, marks the conflict resolved, and triggers a fresh sync to
 * push the chosen value to Google (which lets the cross-stamping in
 * lastSyncedAt + lastGoogleEtag catch up).
 */

import { syncContactToGoogle } from "@/features/contacts/lib/google-contacts";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/contacts/conflicts/[id]
 * Body: `{ winner: "site" | "google" | "custom", customValue?: string }`.
 * - winner "site" - keeps the site value, marks resolved, pushes to Google.
 * - winner "google" - copies Google value to site contact, marks resolved.
 * - winner "custom" - writes `customValue` to site, marks resolved, pushes.
 * Requires X-Admin-Secret header.
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    winner?: unknown;
    customValue?: unknown;
  };
  const winner = body.winner;
  const customValue = typeof body.customValue === "string" ? body.customValue : null;

  if (winner !== "site" && winner !== "google" && winner !== "custom") {
    return NextResponse.json(
      { error: "winner must be 'site' | 'google' | 'custom'" },
      { status: 400 },
    );
  }
  if (winner === "custom" && !customValue) {
    return NextResponse.json(
      { error: "customValue is required when winner is 'custom'" },
      { status: 400 },
    );
  }

  const conflict = await prisma.contactConflict.findUnique({ where: { id } });
  if (!conflict || conflict.resolvedAt) {
    return NextResponse.json({ error: "Conflict not found or already resolved" }, { status: 404 });
  }

  // Decide the chosen value
  const chosenValue =
    winner === "site"
      ? conflict.siteValue
      : winner === "google"
        ? conflict.googleValue
        : customValue;

  // Write the chosen value to the site contact. conflict.field is the
  // ContactField enum so name/email/address are the only possible values.
  const field = conflict.field;

  try {
    await prisma.contact.update({
      where: { id: conflict.contactId },
      // Clearing lastSyncedAt forces the next syncContactToGoogle to treat
      // both sides as freshly changed, so the chosen value reliably propagates
      // to Google regardless of who appeared to "change last".
      data: { [field]: chosenValue, lastSyncedAt: null },
    });

    await prisma.contactConflict.update({
      where: { id },
      data: { resolvedAt: new Date(), resolution: winner },
    });

    // Fire a fresh sync to push the chosen value to Google. Best-effort -
    // syncContactToGoogle never throws.
    await syncContactToGoogle(conflict.contactId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/contacts/conflicts/id] POST error:", err);
    return NextResponse.json({ error: "Failed to resolve conflict" }, { status: 500 });
  }
}
