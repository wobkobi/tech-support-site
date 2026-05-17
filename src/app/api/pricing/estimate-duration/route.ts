import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";

interface EstimateResult {
  estimatedMins: number;
  category: "standard" | "complex";
  explanation: string;
}

const SYSTEM_PROMPT = `You are a tech support time estimator for a solo technician in Auckland, New Zealand.
Given a plain-English description of a tech support job, return a JSON object with exactly these fields:
- "estimatedMins": integer number of minutes for the job (e.g. 60 for 1 hour, 120 for 2 hours)
- "category": "standard" for routine work, or "complex" for specialised/difficult work
- "explanation": one short friendly sentence explaining your estimate (e.g. "Laptop setup and data transfer typically takes around 2 hours.")

Standard jobs ($65/h): troubleshooting, general setup, software installs, tune-ups, Wi-Fi, backups, phone setup, printer setup.
Complex jobs ($85/h): data recovery, hardware repairs, PC builds, full system migrations.

Time benchmarks — use these as direct references:
- Quick software fix, settings change: 30 min
- Virus removal, general tune-up: 60 min
- Phone setup (contacts, apps, email): 60 min
- Printer setup: 45 min
- Wi-Fi troubleshooting: 45 min
- New laptop setup (no data transfer): 60 min
- New laptop setup + data transfer from old laptop: 120 min
- Email / software setup: 45 min
- Hardware upgrade (RAM, SSD): 60 min
- Data recovery: 120 min
- PC build: 180 min

If multiple tasks are described, add the times together.
Round to the nearest 15 minutes.
Return valid JSON only. No markdown, no text outside the JSON object.`;

/**
 * POST /api/pricing/estimate-duration - Estimates job duration and rate category from a plain-English description.
 * @param request - Incoming request with { description: string } body
 * @returns JSON with estimatedMins, category, and explanation
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "estimate-duration", 5, 60_000);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const description = (body as { description?: unknown })?.description;

  if (!description || typeof description !== "string" || !description.trim()) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  const trimmed = description.trim().slice(0, 500);

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 150,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: trimmed },
      ],
    });

    const text = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(text) as EstimateResult;

    if (typeof parsed.estimatedMins !== "number" || !parsed.category || !parsed.explanation) {
      throw new Error("Invalid response shape");
    }

    return NextResponse.json({ ok: true, result: parsed });
  } catch (err) {
    console.error("[estimate-duration] failed:", err);
    return NextResponse.json({ error: "Could not estimate duration" }, { status: 422 });
  }
}
