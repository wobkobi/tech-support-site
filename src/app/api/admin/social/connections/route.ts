// src/app/api/admin/social/connections/route.ts
// Checks each platform's credentials with a harmless read, so a revoked or mistyped token shows
// up in Social before a post fails on it. `?fresh=1` skips the ten-minute cache.

import { checkConnections, recheckConnections } from "@/features/social/lib/connections.server";
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
  const fresh = request.nextUrl.searchParams.get("fresh") === "1";
  const connections = fresh ? await recheckConnections() : await checkConnections();
  return okResponse({ connections });
}
