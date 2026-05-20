// src/app/api/admin/travel/[id]/route.ts
/**
 * @file route.ts
 * @description Admin endpoint to update a TravelBlock's transport mode or custom origin.
 * Setting either clears cached raw minutes so the next recalculation uses the new values.
 */

import { type NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";

const VALID_MODES = new Set(["transit", "driving", "walking", "bicycling"]);

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
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json()) as {
    transportMode?: string;
    customOrigin?: string | null;
  };

  const mode = body.transportMode;
  if (mode !== undefined && !VALID_MODES.has(mode)) {
    return NextResponse.json({ error: "Invalid transport mode" }, { status: 400 });
  }

  const hasMode = mode !== undefined;
  const hasOrigin = "customOrigin" in body;

  if (!hasMode && !hasOrigin) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const block = await prisma.travelBlock.findUnique({ where: { id } });
    if (!block) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.travelBlock.update({
      where: { id },
      data: {
        ...(hasMode && { transportMode: mode }),
        ...(hasOrigin && { customOrigin: body.customOrigin ?? null }),
        // Clear raw minutes so the next recalculate uses the updated values
        rawTravelMinutes: null,
        roundedMinutes: null,
        rawTravelBackMinutes: null,
        roundedBackMinutes: null,
      },
    });

    // Transport-mode overrides on a recurring event apply to the whole series:
    // persist the choice durably and cascade to sibling instances so they all
    // recompute with the new mode on the next cron tick. customOrigin stays
    // per-instance because origins legitimately vary between occurrences.
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
    return NextResponse.json({ ok: false, error: "Update failed" }, { status: 500 });
  }
}
