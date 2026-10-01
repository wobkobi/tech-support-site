// src/app/api/admin/mailing/[id]/send/route.ts
// Sends an email to the list now, or re-sends only the copies that failed.

import { parseObjectId } from "@/features/business/lib/validation";
import { retryFailedSends, startCampaignSend } from "@/features/mailing/lib/send";
import { parseExcludedIds } from "@/features/mailing/lib/validate";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/mailing/[id]/send
 * Body: `{ mode: "now", excludedContactIds }` or `{ mode: "retry" }`.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the campaign id.
 * @returns JSON `{ sent, failed }`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Email not found.", 404);
  const body = (await request.json().catch(() => null)) as {
    mode?: string;
    excludedContactIds?: unknown;
  } | null;

  try {
    if (body?.mode === "retry") {
      const result = await retryFailedSends(id);
      return result.ok ? okResponse(result) : errorResponse(result.error, result.status);
    }
    if (body?.mode === "now") {
      const excluded = parseExcludedIds(body.excludedContactIds);
      if (!excluded) return errorResponse("excludedContactIds must be a list of ids.", 400);
      const result = await startCampaignSend(id, excluded);
      return result.ok ? okResponse(result) : errorResponse(result.error, result.status);
    }
    return errorResponse('mode must be "now" or "retry".', 400);
  } catch (error) {
    console.error("[admin/mailing/send] Error:", error);
    return errorResponse(
      "Sending stopped part-way. Check the email's page for what went out.",
      500,
    );
  }
}
