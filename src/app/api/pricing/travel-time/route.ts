import { NextRequest, NextResponse } from "next/server";

interface DistanceMatrixElement {
  status: string;
  duration: { value: number; text: string };
  distance: { value: number; text: string };
}

interface DistanceMatrixResponse {
  status: string;
  rows: { elements: DistanceMatrixElement[] }[];
}

/**
 * POST /api/pricing/travel-time - Returns drive time from HOME_ADDRESS to a given suburb.
 * @param request - Incoming request with { destination: string } body
 * @returns JSON with durationMins and distanceKm, or durationMins: 0 on any failure
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = process.env.HOME_ADDRESS;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!origin || !apiKey) {
    return NextResponse.json({ durationMins: 0 });
  }

  const body = (await request.json()) as { destination?: unknown };
  const raw = body.destination;

  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return NextResponse.json({ error: "destination is required" }, { status: 400 });
  }

  const destination = `${raw.trim().slice(0, 100)}, New Zealand`;

  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", destination);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("units", "metric");

  try {
    const res = await fetch(url.toString());
    const data = (await res.json()) as DistanceMatrixResponse;
    const element = data?.rows?.[0]?.elements?.[0];

    if (element?.status !== "OK") {
      return NextResponse.json({ durationMins: 0 });
    }

    const durationMins = Math.round(element.duration.value / 60);
    const distanceKm = Math.round((element.distance.value / 1000) * 10) / 10;

    return NextResponse.json({ durationMins, distanceKm });
  } catch {
    return NextResponse.json({ durationMins: 0 });
  }
}
