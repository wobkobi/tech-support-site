// src/app/api/admin/social/inbox/read-all/route.ts
// Marks every unread thread in the inbox read, for one app or all of them.

import { markAllRead } from "@/features/social/lib/inbox/actions.server";
import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "@/features/social/lib/validate";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/social/inbox/read-all
 * Body: `{ platform?: "facebook" | "instagram" | "google" }`.
 * @param request - Incoming request.
 * @returns JSON `{ count }`, the threads marked.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const body = (await request.json().catch(() => null)) as { platform?: unknown } | null;
  const platform = (SOCIAL_PLATFORMS as readonly unknown[]).includes(body?.platform)
    ? (body!.platform as SocialPlatformKey)
    : null;
  try {
    return okResponse({ count: await markAllRead(platform, new Date()) });
  } catch (error) {
    console.error("[admin/social/inbox/read-all] failed:", error);
    return errorResponse("Couldn't mark them read. Try again.", 500);
  }
}
