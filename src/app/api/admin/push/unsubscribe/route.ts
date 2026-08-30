// src/app/api/admin/push/unsubscribe/route.ts
/**
 * @description Removes a registered push device. Deleting an endpoint that is
 * already gone is treated as success so the UI stays idempotent.
 */

import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/push/unsubscribe - Removes a push device by endpoint.
 * @param request - Incoming request with `{ endpoint }`.
 * @returns JSON success payload.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { endpoint } = (await request.json()) as { endpoint?: string };
  if (!endpoint) return errorResponse("endpoint is required", 400);

  // deleteMany rather than delete: removing a device that is already gone is
  // the expected outcome of a double click, not an error worth surfacing.
  await prisma.pushDevice.deleteMany({ where: { endpoint } });
  return NextResponse.json({ ok: true });
}
