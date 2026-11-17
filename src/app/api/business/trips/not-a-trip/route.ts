// src/app/api/business/trips/not-a-trip/route.ts
// Admin "Not a trip" toggle for the jobs-without-a-trip list: a walked job (or one with no
// drive) comes off the list and stays off across reloads, until it's put back.

import { setNotATrip } from "@/features/business/lib/trips.server";
import { parseObjectId } from "@/features/business/lib/validation";
import { errorResponse, noStore, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/business/trips/not-a-trip - Marks a job "Not a trip", or puts it back.
 * @param request - Body: `{ bookingId: string, notATrip: boolean }`.
 * @returns `{ ok: true }`, or 400 for a bad body.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return noStore(errorResponse("Unauthorized", 401));
  }
  const body = (await request.json().catch(() => null)) as {
    bookingId?: unknown;
    notATrip?: unknown;
  } | null;
  const bookingId = parseObjectId(body?.bookingId);
  if (!bookingId || typeof body?.notATrip !== "boolean") {
    return noStore(errorResponse("Send a bookingId and notATrip true or false", 400));
  }
  await setNotATrip(bookingId, body.notATrip);
  return noStore(okResponse());
}
