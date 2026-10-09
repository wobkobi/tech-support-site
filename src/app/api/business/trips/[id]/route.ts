// src/app/api/business/trips/[id]/route.ts
// Admin single-trip endpoint. PUT replaces the trip's date, km, purpose and notes (the
// job link is fixed when the trip is logged); DELETE removes it, which puts a linked
// job back on the suggestions list.

import { parseTripInput, toTripRow } from "@/features/business/lib/trips";
import { TRIP_SELECT } from "@/features/business/lib/trips.server";
import { parseObjectId } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

/**
 * Marks a response as never cacheable: trip data is per-admin and changes on every save.
 * @param res - Response to mark.
 * @returns The same response.
 */
function noStore<T>(res: NextResponse<T>): NextResponse<T> {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * Whether an error is Prisma's "record to update or delete does not exist" (P2025).
 * @param err - Caught error.
 * @returns True for P2025.
 */
function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

/**
 * PUT /api/business/trips/[id] - Replaces a trip's editable fields.
 * @param request - Incoming Next.js request with the trip in the body.
 * @param root0 - Route context.
 * @param root0.params - Route params promise.
 * @returns JSON with the updated trip.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return noStore(errorResponse("Unauthorized", 401));
  }

  // A malformed id would make Prisma throw (P2023); it can't name a trip, so 404.
  const id = parseObjectId((await params).id);
  if (!id) return noStore(errorResponse("Trip not found", 404));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore(errorResponse("Invalid JSON body", 400));
  }
  const parsed = parseTripInput(body);
  if (!parsed.ok) return noStore(errorResponse(parsed.error, 400));

  const { date, km, purpose, notes } = parsed.value;
  try {
    const trip = await prisma.trip.update({
      where: { id },
      data: { date, km, purpose, notes },
      select: TRIP_SELECT,
    });
    return noStore(NextResponse.json({ ok: true, trip: toTripRow(trip) }));
  } catch (err) {
    // A missing or stale id (P2025) is a 404; anything else, such as a DB outage, is a 500.
    if (isRecordNotFound(err)) return noStore(errorResponse("Trip not found", 404));
    throw err;
  }
}

/**
 * DELETE /api/business/trips/[id] - Deletes a trip.
 * @param request - Incoming Next.js request.
 * @param root0 - Route context.
 * @param root0.params - Route params promise.
 * @returns JSON confirming deletion.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return noStore(errorResponse("Unauthorized", 401));
  }

  const id = parseObjectId((await params).id);
  if (!id) return noStore(errorResponse("Trip not found", 404));
  try {
    await prisma.trip.delete({ where: { id } });
    return noStore(NextResponse.json({ ok: true }));
  } catch (err) {
    // A missing or stale id (P2025) is a 404; anything else, such as a DB outage, is a 500.
    if (isRecordNotFound(err)) return noStore(errorResponse("Trip not found", 404));
    throw err;
  }
}
