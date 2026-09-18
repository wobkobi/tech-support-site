// src/app/api/admin/push/subscribe/route.ts
// Registers the calling browser for operator push notifications. Upserts on endpoint so
// re-subscribing the same browser refreshes its keys instead of adding a duplicate row.

import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

interface SubscribeBody {
  endpoint?: unknown;
  p256dh?: unknown;
  auth?: unknown;
  label?: unknown;
  userAgent?: unknown;
}

/**
 * A non-empty string from the body, or null for anything else.
 * @param value - The raw JSON value.
 * @returns The string, or null.
 */
function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
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

  // A malformed body is the caller's mistake: 400, not a 500 from the throw.
  const body = (await request.json().catch(() => null)) as SubscribeBody | null;
  const endpoint = text(body?.endpoint);
  const p256dh = text(body?.p256dh);
  const auth = text(body?.auth);
  if (!endpoint || !p256dh || !auth) {
    return errorResponse("endpoint, p256dh and auth are required", 400);
  }
  const label = text(body?.label);
  const userAgent = text(body?.userAgent);

  const device = await prisma.pushDevice.upsert({
    where: { endpoint },
    // Re-subscribing rotates the encryption keys, so refresh them and clear
    // any failure count from the previous registration.
    update: { p256dh, auth, label, userAgent, failureCount: 0 },
    create: { endpoint, p256dh, auth, label, userAgent },
  });

  return NextResponse.json({ ok: true, device }, { status: 201 });
}
