// src/app/api/admin/contacts/[id]/clear-review-link/route.ts
/**
 * @file route.ts
 * @description Admin endpoint to revoke a Contact's manual review-link send.
 * Clears reviewToken, reviewLinkSentAt, reviewLinkSentMode and
 * reviewLinkSubmittedAt so the contact disappears from the link history
 * (replaces the old DELETE /api/admin/review-requests/[id] flow).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

/**
 * POST /api/admin/contacts/[id]/clear-review-link
 * Clears the review-link send state on a Contact. Idempotent.
 * @param request - Incoming admin request.
 * @param params - Route params holder.
 * @param params.params - Promise of dynamic params with the contact id.
 * @returns JSON ok flag.
 */
export async function POST(
  request: NextRequest,
  params: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params.params;
  try {
    await prisma.contact.update({
      where: { id },
      data: {
        reviewToken: null,
        reviewLinkSentAt: null,
        reviewLinkSentMode: null,
        reviewLinkSubmittedAt: null,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[api/admin/contacts/${id}/clear-review-link] failed:`, err);
    return NextResponse.json({ error: "Failed to clear review link." }, { status: 500 });
  }
}
