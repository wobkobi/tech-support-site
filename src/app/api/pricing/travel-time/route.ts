import { lookupDriveDistance } from "@/features/business/lib/travel-distance";
import { errorResponse } from "@/shared/lib/api-response";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * POST /api/pricing/travel-time - Drive time from HOME_ADDRESS to destination.
 * Optional `departureTimeIso` enables traffic-aware quoting; malformed/missing
 * values fall back to "now".
 * @param request - Body: `{ destination: string, departureTimeIso?: string }`.
 * @returns `{ durationMins, distanceKm }` on success, durationMins: 0 when
 *   unresolvable, 503 on misconfig / upstream errors so the operator notices.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "travel-time", 5, 60_000);
  if (limited) return limited;

  const body = (await request.json()) as { destination?: unknown; departureTimeIso?: unknown };
  const raw = body.destination;

  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return errorResponse("destination is required", 400);
  }

  let departureTime: Date | undefined;
  if (typeof body.departureTimeIso === "string" && body.departureTimeIso.trim()) {
    const parsed = new Date(body.departureTimeIso);
    if (!isNaN(parsed.getTime())) departureTime = parsed;
  }

  const result = await lookupDriveDistance(raw, departureTime);
  switch (result.status) {
    case "ok":
      return NextResponse.json(result.data);
    case "no_match":
      return NextResponse.json({ durationMins: 0 });
    case "misconfig":
      console.error("[travel-time] HOME_ADDRESS or Google Maps key is not set");
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
