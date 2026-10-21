// src/app/api/admin/social/designs/pictures/route.ts
// Exported design pictures for the mail Picture block's "Use a design" picker, newest
// first, with whether each still matches its design.

import { loadEmailPictures } from "@/features/social-design/lib/email-pictures";
import { errorResponse, noStore, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/social/designs/pictures - exported design pictures for an email.
 * @param request - Incoming request.
 * @returns JSON `{ designs }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  return noStore(okResponse({ designs: await loadEmailPictures() }));
}
