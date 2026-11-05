// src/app/i/[token]/route.ts
// Customer link to an invoice PDF, as carried by the invoice email, reminders and texts.

import { sharedInvoiceResponse } from "@/features/business/lib/invoice-share";

/**
 * GET /i/[token] - the invoice PDF behind a customer link.
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
