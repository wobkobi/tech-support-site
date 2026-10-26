// src/app/api/pricing/log-estimate/route.ts
// Public, rate-limited log of what the price estimator showed a user; returns the
// PriceEstimateLog id so the booking can snapshot the quote seen.

import { getRateRows } from "@/features/business/lib/pricing-policy.server";
import { errorResponse } from "@/shared/lib/api-response";
import { prisma } from "@/shared/lib/prisma";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { AiEstimateCategory } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

interface LogBody {
  description?: unknown;
  aiEstimatedMins?: unknown;
  aiCategory?: unknown;
  aiExplanation?: unknown;
  aiTasks?: unknown;
  address?: unknown;
  travelMins?: unknown;
  travelMinsBack?: unknown;
  hourlyRate?: unknown;
  priceLow?: unknown;
  priceHigh?: unknown;
  travelCharge?: unknown;
  promoTitle?: unknown;
  promoLabel?: unknown;
}

interface CleanTask {
  label: string;
  mins: number;
}

/**
 * Parse untrusted AI tasks, dropping malformed entries and capping at 10.
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
 * POST /api/pricing/log-estimate - fire-and-forget log of an estimate shown.
 * @param request - Incoming request carrying the LogBody payload.
 * @returns Empty 200 JSON on success, 400 on bad input.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "log-estimate", 10, 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as LogBody | null;
  if (!body) return errorResponse("invalid body", 400);

  const description =
    typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
  if (!description) return errorResponse("description required", 400);

  const aiEstimatedMins = Math.max(0, Math.round(Number(body.aiEstimatedMins) || 0));
  // No "complex" tier exists; the enum stays so older rows still read.
  const aiCategory: AiEstimateCategory = AiEstimateCategory.standard;
  const aiExplanation =
    typeof body.aiExplanation === "string" ? body.aiExplanation.trim().slice(0, 400) : "";
  const aiTasks = cleanTasks(body.aiTasks);

  const address =
    typeof body.address === "string" && body.address.trim()
      ? body.address.trim().slice(0, 300)
      : null;
  const travelMins =
    body.travelMins == null ? null : Math.max(0, Math.round(Number(body.travelMins) || 0));
  const travelMinsBack =
    body.travelMinsBack == null ? null : Math.max(0, Math.round(Number(body.travelMinsBack) || 0));

  const hourlyRate = Math.max(0, Number(body.hourlyRate) || 0);
  const priceLow = Math.max(0, Math.round(Number(body.priceLow) || 0));
  const priceHigh = Math.max(0, Math.round(Number(body.priceHigh) || 0));
  const travelCharge =
    body.travelCharge == null ? null : Math.max(0, Math.round(Number(body.travelCharge) || 0));

  // The figures come from the visitor's browser, and a booking made after it shows them to
  // you as its quote. Shapes the estimator can't produce (a low above the high, travel above
  // the whole quote, a total under half a quarter-hour at the cheapest rate) are refused, so
  // a hand-made "$1" never reaches a booking.
  const rates = await getRateRows().catch(() => []);
  const cheapestRate = Math.min(
    ...rates.flatMap((r) => (r.ratePerHour && r.ratePerHour > 0 ? [r.ratePerHour] : [])),
  );
  const floor = Number.isFinite(cheapestRate) ? (cheapestRate * 0.25) / 2 : 0;
  if (priceLow > priceHigh || (travelCharge ?? 0) > priceLow || priceLow < floor) {
    console.warn(
      `[log-estimate] refused an estimate that doesn't add up: ${priceLow}-${priceHigh}, travel ${travelCharge}`,
    );
    return errorResponse("estimate figures don't add up", 400);
  }

  const promoTitle =
    typeof body.promoTitle === "string" && body.promoTitle.trim()
      ? body.promoTitle.trim().slice(0, 120)
      : null;
  const promoLabel =
    typeof body.promoLabel === "string" && body.promoLabel.trim()
      ? body.promoLabel.trim().slice(0, 200)
      : null;

  // "development" only locally (previews run as production); admin hides local test rows.
  const environment = process.env.NODE_ENV ?? "production";

  try {
    const created = await prisma.priceEstimateLog.create({
      data: {
        description,
        aiEstimatedMins,
        aiCategory,
        aiExplanation,
        aiTasks,
        address,
        travelMins,
        travelMinsBack,
        hourlyRate,
        priceLow,
        priceHigh,
        travelCharge,
        promoTitle,
        promoLabel,
        environment,
      },
    });
    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    console.error("[log-estimate] failed:", err);
    return errorResponse("Could not log estimate", 500);
  }
}
