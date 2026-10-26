// src/app/api/admin/push/test/route.ts
// Sends a test notification to every device; iOS drops subscriptions silently, so this confirms delivery.

import { pushTestReply, sendOwnerPush } from "@/features/notifications/lib/push";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/push/test - Sends a test notification.
 * @param request - Incoming request.
 * @returns JSON with the message to show; an error status unless a device took it.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const result = await sendOwnerPush({
    title: "Test notification",
    body: "Push is working on this device.",
    url: "/admin/notifications",
    // Unique tag so repeat tests are visible rather than collapsing into one.
    tag: `test-${Date.now()}`,
  });

  const { status, message } = pushTestReply(result);
  if (status !== 200) return errorResponse(message, status);
  return NextResponse.json({ ok: true, message, ...result });
}
