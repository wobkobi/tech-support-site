// src/app/api/admin/push/test/route.ts
/**
 * @description Sends a test notification to every registered device. iOS drops
 * push subscriptions with no client-side event, so this is the only way to
 * confirm a device still actually receives anything.
 */

import { sendOwnerPush } from "@/features/notifications/lib/push";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/push/test - Sends a test notification.
 * @param request - Incoming request.
 * @returns JSON success payload.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  await sendOwnerPush({
    title: "Test notification",
    body: "Push is working on this device.",
    url: "/admin/notifications",
    // Unique tag so repeat tests are visible rather than collapsing into one.
    tag: `test-${Date.now()}`,
  });

  return NextResponse.json({ ok: true });
}
