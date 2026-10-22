// src/app/api/admin/social/permissions/route.ts
// What each app can do: the Meta token's permissions and expiry, and whether each Google API
// answers. `?fresh=1` skips the ten-minute cache.

import { checkPermissions, recheckPermissions } from "@/features/social/lib/permissions.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/social/permissions
 * @param request - Incoming request.
 * @returns JSON `{ permissions: { setUp, token, tokenError, google } }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const fresh = request.nextUrl.searchParams.get("fresh") === "1";
  try {
    const permissions = fresh ? await recheckPermissions() : await checkPermissions();
    return okResponse({ permissions });
  } catch (error) {
    console.error("[admin/social/permissions] Check failed:", error);
    return errorResponse("Couldn't check the permissions.", 500);
  }
}
