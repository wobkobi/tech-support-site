// src/app/api/admin/push/devices/route.ts
/**
 * @description Lists registered push devices for the notifications admin page.
 */

import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/push/devices - Lists devices newest first.
 * @param request - Incoming request.
 * @returns JSON with the devices array.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const devices = await prisma.pushDevice.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ ok: true, devices });
}
