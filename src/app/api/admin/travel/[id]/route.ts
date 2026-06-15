// src/app/api/admin/travel/[id]/route.ts
/**
 * @file route.ts
 * @description Admin endpoint to update a TravelBlock's transport mode, custom
 * origin, or custom travel-back destination. Setting any clears cached raw
 * minutes so the next refresh recalculates.
 */

import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { TransportMode } from "@prisma/client";
import { type NextRequest, NextResponse } from "next/server";

const VALID_MODES = new Set<string>(Object.values(TransportMode));

/**
 * Updates the transport mode and/or custom origin for a travel block.
 * Clears raw travel minutes so the next cache refresh recalculates with the new values.
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
        // Clear raw minutes so the next recalculate uses the updated values
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

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[travel/[id]] Error:", error);
    return errorResponse("Update failed", 500);
  }
}
