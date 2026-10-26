// src/app/api/admin/contacts/[id]/review-link-texted/route.ts
// Records a hand-sent review text as the Contact's review-link send. There's no SMS provider, so
// copying the composed text is the last step the site sees.

import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { ReviewLinkMode } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/contacts/[id]/review-link-texted
 * Stamps the send time and SMS mode, like an emailed ask. The contact needs the review token
 * the text was composed with.
 * @param request - Incoming admin request.
 * @param params - Route params holder.
 * @param params.params - Promise of dynamic params with the contact id.
 * @returns JSON ok flag; 404 when there's no live contact with a review link.
 */
export async function POST(
  request: NextRequest,
  params: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params.params;
  try {
    const stamped = await prisma.contact.updateMany({
      where: { id, deletedAt: null, reviewToken: { not: null } },
      data: { reviewLinkSentAt: new Date(), reviewLinkSentMode: ReviewLinkMode.sms },
    });
    if (stamped.count === 0) return errorResponse("That contact has no review link.", 404);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[api/admin/contacts/${id}/review-link-texted] failed:`, err);
    return errorResponse("Couldn't record the text.", 500);
  }
}
