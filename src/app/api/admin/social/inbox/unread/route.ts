// src/app/api/admin/social/inbox/unread/route.ts
// The inbox's unread thread count, for the sidebar's Social badge.

import { unreadCount } from "@/features/social/lib/inbox/inbox-data.server";
import { errorResponse, noStore, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/social/inbox/unread
 * @param request - Incoming request.
 * @returns JSON `{ count }`; 0 when the read fails.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  return noStore(okResponse({ count: await unreadCount() }));
}
