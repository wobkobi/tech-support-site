// src/app/api/admin/contacts/[id]/review-ask-opt-out/route.ts
// Admin "Allow again" on a contact who asked not to get review asks. Only for when they
// have said they're happy to be asked again - the opt-out is theirs to make.

import { allowReviewAsks } from "@/features/reviews/lib/review-ask-opt-out";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * DELETE /api/admin/contacts/[id]/review-ask-opt-out
 * Removes every review-ask opt-out tied to the contact. Idempotent.
 * @param request - Incoming admin request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the contact id.
 * @returns JSON `{ ok }`.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;
  try {
    await allowReviewAsks(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[admin/contacts/${id}/review-ask-opt-out] Error:`, error);
    return errorResponse("Couldn't clear the opt-out.", 500);
  }
}
