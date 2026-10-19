// src/app/api/webhooks/resend/route.ts
// Resend delivery webhook: hard bounces and spam reports opt the address out (protecting
// sender reputation); a bounce on a recent booking alerts the operator as likely fake.

import { flagBouncedBookings } from "@/features/booking/lib/bounced-booking.server";
import { optOutActionFor } from "@/features/mailing/lib/delivery-events";
import { optOutForDelivery } from "@/features/mailing/lib/opt-out";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

/**
 * POST /api/webhooks/resend - subscribed to `email.bounced`, `email.complained` and
 * `email.suppressed`; other events are acknowledged and ignored.
 * @param request - Incoming request, signed with Svix headers.
 * @returns JSON `{ ok }`, a 401 for a bad signature, or a 503 when the secret isn't set.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!secret || !apiKey)
    return errorResponse("RESEND_WEBHOOK_SECRET or RESEND_API_KEY isn't set.", 503);
  const resend = new Resend(apiKey);

  // The signature covers the exact bytes sent, so read the raw text, not parsed JSON.
  const payload = await request.text();
  let event: unknown;
  try {
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: request.headers.get("svix-id") ?? "",
        timestamp: request.headers.get("svix-timestamp") ?? "",
        signature: request.headers.get("svix-signature") ?? "",
      },
      webhookSecret: secret,
    });
  } catch {
    return errorResponse("Invalid signature", 401);
  }

  const action = optOutActionFor(event);
  if (!action) return okResponse();
  try {
    await optOutForDelivery(action);
    // Swallows its own errors so a push failure can't make Resend retry the opt-out.
    if (action.source === "bounce") await flagBouncedBookings(action.emails);
    return okResponse();
  } catch (error) {
    // A 500 makes Resend retry the event later.
    console.error("[webhooks/resend] Opt-out failed:", error);
    return errorResponse("Couldn't record the opt-out.", 500);
  }
}
