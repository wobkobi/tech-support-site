// src/app/api/admin/social/checklist/route.ts
// The Overview's set-up list: skip a step you don't need, or put it back.

import { isChecklistKey } from "@/features/social/lib/checklist";
import { setChecklistSkipped } from "@/features/social/lib/overview-data.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * PUT /api/admin/social/checklist
 * Body: `{ key, skipped }`.
 * @param request - Incoming request.
 * @returns JSON `{ skipped }`, every step skipped now.
 */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const body = (await request.json().catch(() => null)) as {
    key?: unknown;
    skipped?: unknown;
  } | null;
  if (!isChecklistKey(body?.key)) return errorResponse("That isn't one of the steps.", 400);
  if (typeof body.skipped !== "boolean") {
    return errorResponse("skipped must be true or false.", 400);
  }
  try {
    return okResponse({ skipped: await setChecklistSkipped(body.key, body.skipped) });
  } catch (error) {
    console.error("[admin/social/checklist] Save failed:", error);
    return errorResponse("Couldn't save that.", 500);
  }
}
