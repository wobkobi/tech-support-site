// src/app/api/business/store-run/route.ts
// Admin-only drive lookup for a mid-job store run: the client's place > the store > back.
// Kept off the public travel-time route because it takes any start point, which would
// let anyone spend the Google Maps quota on arbitrary routes.

import { lookupStoreRun } from "@/features/business/lib/travel-distance";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/business/store-run - times a store run.
 * @param request - Body: `{ from: string, store: string }`.
 * @returns `{ ok: true, durationMinsThere, durationMinsBack, distanceKm }`, zero durations
 *   when either place can't be found, 503 on misconfig and 502 on upstream errors.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const body = (await request.json().catch(() => null)) as {
    from?: unknown;
    store?: unknown;
  } | null;
  const from = typeof body?.from === "string" ? body.from.trim() : "";
  const store = typeof body?.store === "string" ? body.store.trim() : "";
  if (!from) return errorResponse("Add the client's address first.", 400);
  if (!store) return errorResponse("Name the store.", 400);

  const result = await lookupStoreRun(from, store);
  switch (result.status) {
    case "ok":
      return okResponse({
        durationMinsThere: result.data.there.durationMins,
        durationMinsBack: result.data.back.durationMins,
        distanceKm: result.data.there.distanceKm,
      });
    case "no_match":
      return okResponse({ durationMinsThere: 0, durationMinsBack: 0 });
    case "misconfig":
      console.error("[store-run] Google Maps server key is not set");
      return errorResponse("Travel lookup is temporarily unavailable.", 503);
    case "error":
      return errorResponse("Travel lookup failed. Please try again.", 502);
  }
}
