// src/app/api/admin/travel/[id]/route.ts
/**
 * @description Admin endpoint to update a TravelBlock's transport mode, custom
 * origin, or custom travel-back destination. A travel-affecting change reprices
 * the block's two legs immediately - the 15-min cron only maintains upcoming
 * events, so a past job would otherwise sit blank after the change.
 */

import {
  recomputeTravelBlock,
  type RecomputedTravel,
} from "@/features/calendar/lib/calendar-cache";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { TransportMode } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

// A mode/origin change makes up to two Distance Matrix calls (there + back), so
// lift the ceiling above the default to avoid a 504 on a slow upstream.
export const maxDuration = 60;

const VALID_MODES = new Set<string>(Object.values(TransportMode));

/**
 * Updates the transport mode and/or custom origin for a travel block, then
 * reprices its travel-there / travel-back minutes immediately so the change
 * lands even on a past job the cron won't revisit.
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
    ignored?: boolean;
  };

  const rawMode = body.transportMode;
  if (rawMode !== undefined && !VALID_MODES.has(rawMode)) {
    return errorResponse("Invalid transport mode", 400);
  }
  const mode = rawMode as TransportMode | undefined;

  const hasMode = mode !== undefined;
  const hasOrigin = "customOrigin" in body;
  const hasBackDest = "customTravelBackDestination" in body;
  const hasIgnored = typeof body.ignored === "boolean";

  if (!hasMode && !hasOrigin && !hasBackDest && !hasIgnored) {
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
        ...(hasIgnored && { ignored: body.ignored }),
        // Clear the stale minutes up front; the recompute below refills them
        // (they stay blank as a safe fallback only if that call fails).
        rawTravelMinutes: null,
        roundedMinutes: null,
        rawTravelBackMinutes: null,
        roundedBackMinutes: null,
      },
    });

    // When toggling ignored=true, eagerly purge the event's calendar cache
    // entry so the booking page unblocks immediately rather than waiting for
    // the next cron run. When toggling back to false, the cron will repopulate.
    if (hasIgnored && body.ignored === true) {
      try {
        await prisma.calendarEventCache.deleteMany({
          where: { eventId: block.sourceEventId, calendarEmail: block.calendarEmail },
        });
      } catch (err) {
        console.error("[travel/[id]] Failed to purge cache entry on ignore:", err);
      }
    }

    // Transport-mode overrides apply to the whole series - persist + cascade
    // to siblings. customOrigin stays per-instance (origins vary by occurrence).
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

    // Refill the minutes now, from the block's stored endpoints, rather than
    // waiting on a cron that only touches upcoming events. An ignored-only
    // toggle changes no route, so it skips the repricing.
    let travel: RecomputedTravel | null = null;
    if (hasMode || hasOrigin || hasBackDest) {
      try {
        travel = await recomputeTravelBlock(id);
      } catch (err) {
        // The field change already saved; leave the minutes blank and let the
        // operator retry (an upcoming job also self-heals on the next cron).
        console.error("[travel/[id]] Immediate recompute failed:", err);
      }
    }

    return NextResponse.json({ ok: true, travel });
  } catch (error) {
    console.error("[travel/[id]] Error:", error);
    return errorResponse("Update failed", 500);
  }
}
