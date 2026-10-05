// src/app/api/admin/social/connections/route.ts
// Checks each platform's credentials with a harmless read, so a revoked or mistyped
// token shows up on the Social page before a post fails on it.

import { PLATFORMS } from "@/features/social/lib/platforms";
import { SOCIAL_PLATFORMS } from "@/features/social/lib/validate";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/social/connections
 * @param request - Incoming request.
 * @returns JSON `{ connections: { platform, ok, label | error }[] }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const connections = await Promise.all(
    SOCIAL_PLATFORMS.map(async (platform) => {
      const adapter = PLATFORMS[platform];
      const missing = adapter.missingEnv();
      if (missing.length > 0) {
        return { platform, ok: false, error: `Not set up: ${missing.join(", ")} missing.` };
      }
      return { platform, ...(await adapter.checkConnection()) };
    }),
  );
  return okResponse({ connections });
}
