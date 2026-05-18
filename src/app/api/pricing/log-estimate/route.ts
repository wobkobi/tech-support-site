import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";

interface LogBody {
  description?: unknown;
  aiEstimatedMins?: unknown;
  aiCategory?: unknown;
  aiExplanation?: unknown;
  aiTasks?: unknown;
  address?: unknown;
  travelMins?: unknown;
  hourlyRate?: unknown;
  priceLow?: unknown;
  priceHigh?: unknown;
  promoTitle?: unknown;
  promoLabel?: unknown;
}

interface CleanTask {
  label: string;
  mins: number;
}

/**
 * Parses the AI tasks array from an untrusted body. Drops malformed entries
 * and caps to 10 to keep log rows bounded.
 * @param raw - Whatever the client posted under `aiTasks`.
 * @returns Cleaned task array (may be empty).
 */
function cleanTasks(raw: unknown): CleanTask[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 10)
    .map((t) => {
      const obj = t as { label?: unknown; mins?: unknown };
      const label = typeof obj?.label === "string" ? obj.label.trim().slice(0, 80) : "";
      const mins = Math.max(0, Math.round(Number(obj?.mins) || 0));
      return { label, mins };
    })
    .filter((t) => t.label.length > 0);
}

/**
 * POST /api/pricing/log-estimate - Records what the public price estimator
 * showed to a user (raw description, AI interpretation, final range).
 * Fire-and-forget from the client; failures should not break the UX.
 * @param request - Incoming request carrying the LogBody payload.
 * @returns Empty 200 JSON on success, 400 on bad input.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "log-estimate", 10, 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as LogBody | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const description =
    typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
  if (!description) return NextResponse.json({ error: "description required" }, { status: 400 });

  const aiEstimatedMins = Math.max(0, Math.round(Number(body.aiEstimatedMins) || 0));
  const aiCategory =
    typeof body.aiCategory === "string" ? body.aiCategory.slice(0, 32) : "standard";
  const aiExplanation =
    typeof body.aiExplanation === "string" ? body.aiExplanation.trim().slice(0, 400) : "";
  const aiTasks = cleanTasks(body.aiTasks);

  const address =
    typeof body.address === "string" && body.address.trim()
      ? body.address.trim().slice(0, 300)
      : null;
  const travelMins =
    body.travelMins == null ? null : Math.max(0, Math.round(Number(body.travelMins) || 0));

  const hourlyRate = Math.max(0, Number(body.hourlyRate) || 0);
  const priceLow = Math.max(0, Math.round(Number(body.priceLow) || 0));
  const priceHigh = Math.max(0, Math.round(Number(body.priceHigh) || 0));

  const promoTitle =
    typeof body.promoTitle === "string" && body.promoTitle.trim()
      ? body.promoTitle.trim().slice(0, 120)
      : null;
  const promoLabel =
    typeof body.promoLabel === "string" && body.promoLabel.trim()
      ? body.promoLabel.trim().slice(0, 200)
      : null;

  // NODE_ENV is "production" on Vercel (both prod and preview deploys run
  // Next.js in production mode) and "development" when I run `npm run dev`
  // locally. The admin page uses this to hide my own test submissions.
  const environment = process.env.NODE_ENV ?? "production";

  try {
    await prisma.priceEstimateLog.create({
      data: {
        description,
        aiEstimatedMins,
        aiCategory,
        aiExplanation,
        aiTasks,
        address,
        travelMins,
        hourlyRate,
        priceLow,
        priceHigh,
        promoTitle,
        promoLabel,
        environment,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[log-estimate] failed:", err);
    return NextResponse.json({ ok: false, error: "Could not log estimate" }, { status: 500 });
  }
}
