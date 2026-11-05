// src/app/api/pricing/estimate-duration/route.ts
// Public, rate-limited AI estimate of job duration from a plain-English description, with
// the per-task split rebalanced to sum exactly to estimatedMins.

import {
  generateEstimate,
  liveEstimateContext,
} from "@/features/business/lib/estimate-duration.server";
import { aiRateLimitResponse } from "@/shared/lib/ai-rate-limit";
import { aiProviderKey, isAiRateLimitError } from "@/shared/lib/ai/json-completion";
import { errorResponse } from "@/shared/lib/api-response";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { getSettings, SETTINGS_TAG } from "@/shared/lib/settings/get-settings";
import { createHash } from "crypto";
import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

/**
 * Cache key ignoring case, spacing and trailing punctuation, so the pricing page and
 * booking form reuse one estimate for the same job.
 * @param description - The (already trimmed) customer description.
 * @returns Normalised key string.
 */
function normaliseEstimateKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,!?;:]+$/, "")
    .slice(0, 500);
}

/**
 * POST /api/pricing/estimate-duration - Estimates job duration from a plain-English description.
 * @param request - Incoming request with { description: string } body
 * @returns JSON with estimatedMins, explanation, and per-task split
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "estimate-duration", 5, 60_000);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const description = (body as { description?: unknown })?.description;

  if (!description || typeof description !== "string" || !description.trim()) {
    return errorResponse("description is required", 400);
  }

  const trimmed = description.trim().slice(0, 500);

  try {
    const [{ context, incrementMins, minBillableMins }, settings] = await Promise.all([
      liveEstimateContext(),
      getSettings(),
    ]);
    const maxJobMins = settings.estimator.maxJobHours * 60;

    // Memoise by description + context hash; maxJobMins (clamps, not in context) and the
    // provider join the key. A fallback-provider answer stored under the main key is fine.
    const estimateKey = normaliseEstimateKey(trimmed);
    const contextHash = createHash("sha256").update(context).digest("hex");
    const getEstimate = unstable_cache(
      () => generateEstimate(trimmed, context, minBillableMins, incrementMins, maxJobMins),
      [
        "estimate-duration",
        estimateKey,
        contextHash,
        String(maxJobMins),
        aiProviderKey("estimate"),
      ],
      { tags: [SETTINGS_TAG], revalidate: 86_400 },
    );
    const result = await getEstimate();

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[estimate-duration] failed:", err);
    // Upstream 429s are transient: mark them retryable.
    if (isAiRateLimitError(err)) {
      return aiRateLimitResponse(err);
    }
    return errorResponse("Could not estimate duration", 422);
  }
}
