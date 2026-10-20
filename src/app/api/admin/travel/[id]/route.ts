// src/app/api/admin/travel/[id]/route.ts
// Updates a TravelBlock's mode, origin or return destination and reprices both legs now,
// since the cron only maintains upcoming events.

import {
  recomputeTravelBlock,
  type RecomputedTravel,
} from "@/features/calendar/lib/calendar-cache";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { TransportMode } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

const VALID_MODES = new Set<string>(Object.values(TransportMode));

/**
 * Updates a travel block's mode and/or origin, then reprices both legs immediately.
 * @param request - Incoming admin request.
 * @param root0 - Route params.
 * @param root0.params - Route params with id.
 * @returns JSON with ok, or an error response.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;
  const body = (await request.json()) as {
    transportMode?: string;
    customOrigin?: string | null;
    customTravelBackDestination?: string | null;
  };

  const rawMode = body.transportMode;
  if (rawMode !== undefined && !VALID_MODES.has(rawMode)) {
    return errorResponse("Invalid transport mode", 400);
  }
  const mode = rawMode as TransportMode | undefined;

  const hasMode = mode !== undefined;
  const hasOrigin = "customOrigin" in body;
  const hasBackDest = "customTravelBackDestination" in body;

  if (!hasMode && !hasOrigin && !hasBackDest) {
    return errorResponse("Nothing to update", 400);
  }

  try {
    const block = await prisma.travelBlock.findUnique({ where: { id } });
    if (!block) {
      return errorResponse("Not found", 404);
    }

    await prisma.travelBlock.update({
      where: { id },
      data: {
        ...(hasMode && { transportMode: mode }),
        ...(hasOrigin && { customOrigin: body.customOrigin ?? null }),
        ...(hasBackDest && {
          customTravelBackDestination: body.customTravelBackDestination ?? null,
        }),
        // Clear stale minutes; the recompute below refills them.
        rawTravelMinutes: null,
        roundedMinutes: null,
        rawTravelBackMinutes: null,
        roundedBackMinutes: null,
      },
    });

    // Transport mode cascades to the series; customOrigin stays per-instance.
    if (hasMode && mode !== undefined && block.recurringEventId) {
      await prisma.recurringTravelPreference.upsert({
        where: {
          recurringEventId_calendarEmail: {
            recurringEventId: block.recurringEventId,
            calendarEmail: block.calendarEmail,
          },
        },
        create: {
          recurringEventId: block.recurringEventId,
          calendarEmail: block.calendarEmail,
          transportMode: mode,
        },
        update: { transportMode: mode },
      });

      await prisma.travelBlock.updateMany({
        where: {
          recurringEventId: block.recurringEventId,
          calendarEmail: block.calendarEmail,
          id: { not: id },
        },
        data: {
          transportMode: mode,
          rawTravelMinutes: null,
          roundedMinutes: null,
          rawTravelBackMinutes: null,
          roundedBackMinutes: null,
        },
      });
    }

    // Refill the minutes now.
    let travel: RecomputedTravel | null = null;
    try {
      travel = await recomputeTravelBlock(id);
    } catch (err) {
      // The field change saved; leave minutes blank for a retry.
      console.error("[travel/[id]] Immediate recompute failed:", err);
    }

    return NextResponse.json({ ok: true, travel });
  } catch (error) {
    console.error("[travel/[id]] Error:", error);
    return errorResponse("Update failed", 500);
  }
}
