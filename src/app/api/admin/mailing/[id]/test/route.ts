// src/app/api/admin/mailing/[id]/test/route.ts
// Sends the saved version of an email to the operator's own inbox.

import { parseObjectId } from "@/features/business/lib/validation";
import { sendTestEmail } from "@/features/mailing/lib/send";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/mailing/[id]/test
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the campaign id.
 * @returns JSON `{ to }` naming the inbox it went to.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  const campaign = id ? await prisma.campaign.findUnique({ where: { id } }) : null;
  if (!campaign) return errorResponse("Email not found.", 404);

  try {
    const result = await sendTestEmail(
      { subject: campaign.subject, preheader: campaign.preheader, body: campaign.body },
      campaign.promoId,
    );
    if (!result.ok) return errorResponse(result.error, result.status);
    return okResponse({ to: process.env.ADMIN_EMAIL });
  } catch (error) {
    console.error("[admin/mailing/test] Error:", error);
    return errorResponse("Couldn't send the test.", 500);
  }
}
