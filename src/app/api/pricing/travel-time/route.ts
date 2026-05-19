import { NextRequest, NextResponse } from "next/server";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { lookupDriveDistance } from "@/features/business/lib/travel-distance";

/**
 * POST /api/pricing/travel-time - Returns drive time from HOME_ADDRESS to a given suburb.
 * @param request - Incoming request with { destination: string } body
 * @returns JSON with durationMins + distanceKm on success, durationMins: 0 when
 *   the address can't be resolved, or 503 when the upstream is misconfigured /
 *   erroring so the operator notices instead of silently quoting $0 travel.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "travel-time", 5, 60_000);
  if (limited) return limited;

  const body = (await request.json()) as { destination?: unknown };
  const raw = body.destination;

  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return NextResponse.json({ error: "destination is required" }, { status: 400 });
  }

  const result = await lookupDriveDistance(raw);
  switch (result.status) {
    case "ok":
      return NextResponse.json(result.data);
    case "no_match":
      return NextResponse.json({ durationMins: 0 });
    case "misconfig":
      console.error("[travel-time] HOME_ADDRESS or GOOGLE_MAPS_API_KEY is not set");
      return NextResponse.json(
        { error: "Travel lookup is temporarily unavailable." },
        { status: 503 },
      );
    case "error":
      return NextResponse.json(
        { error: "Travel lookup failed. Please try again." },
        { status: 502 },
      );
  }
}
