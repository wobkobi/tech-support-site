// src/app/q/[token]/route.ts
// Customer link to a quote PDF, as carried by the quote email and texts.

import { sharedInvoiceResponse } from "@/features/business/lib/invoice-share";

/**
 * GET /q/[token] - the quote PDF behind a customer link.
 * @param _request - Unused.
 * @param ctx - Route ctx with the link code.
 * @param ctx.params - Resolved Next.js dynamic route params.
 * @returns The PDF inline, or a 404 note.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  return sharedInvoiceResponse(token);
}
