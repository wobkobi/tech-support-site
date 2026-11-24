// src/app/q/[token]/route.ts
// Customer link to a quote PDF, as carried by the quote email and texts.

import { sharedInvoiceResponse } from "@/features/business/lib/invoice-share";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import type { NextRequest } from "next/server";

/**
 * GET /q/[token] - the quote PDF behind a customer link.
 * @param request - Incoming request, for the per-IP limit.
 * @param ctx - Route ctx with the link code.
 * @param ctx.params - Resolved Next.js dynamic route params.
 * @returns The PDF inline, or a 404 note.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  // Each hit rebuilds a PDF, and the limit slows anyone guessing codes.
  const limited = rateLimitOrReject(request, "invoice-share-link", 30, 60_000);
  if (limited) return limited;
  const { token } = await ctx.params;
  return sharedInvoiceResponse(token);
}
