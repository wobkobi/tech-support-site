// src/app/api/admin/push/subscribe/route.ts
/**
 * @description Registers the calling browser for operator push notifications.
 * Upserts on endpoint so re-subscribing the same browser refreshes its keys
 * instead of adding a duplicate row.
 */

import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

interface SubscribeBody {
  endpoint?: string;
  p256dh?: string;
  auth?: string;
  label?: string;
  userAgent?: string;
}

/**
 * POST /api/admin/push/subscribe - Registers or refreshes a push device.
 * @param request - Incoming request carrying the browser's subscription.
 * @returns JSON with the stored device.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const body = (await request.json()) as SubscribeBody;
  if (!body.endpoint || !body.p256dh || !body.auth) {
    return errorResponse("endpoint, p256dh and auth are required", 400);
  }

  const device = await prisma.pushDevice.upsert({
    where: { endpoint: body.endpoint },
    // Re-subscribing rotates the encryption keys, so refresh them and clear
    // any failure count from the previous registration.
    update: {
      p256dh: body.p256dh,
      auth: body.auth,
      label: body.label ?? null,
      userAgent: body.userAgent ?? null,
      failureCount: 0,
    },
    create: {
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
      label: body.label ?? null,
      userAgent: body.userAgent ?? null,
    },
  });

  return NextResponse.json({ ok: true, device }, { status: 201 });
}
