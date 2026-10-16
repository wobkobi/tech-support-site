// src/app/api/webhooks/resend/route.ts
// Resend's delivery webhook. A hard bounce or a spam report takes the address off the
// mailing list, so the list stops writing to dead addresses and people who don't want it,
// both of which count against the sender's reputation. A hard bounce on a recent
// booking's address also pushes the operator, since that booking is likely fake.
// Every call is checked against the webhook's signing secret before anything is read.

import { flagBouncedBookings } from "@/features/booking/lib/bounced-booking.server";
import { optOutActionFor } from "@/features/mailing/lib/delivery-events";
import { optOutForDelivery } from "@/features/mailing/lib/opt-out";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

/**
 * POST /api/webhooks/resend
 * Set up in Resend > Webhooks for `email.bounced`, `email.complained` and
 * `email.suppressed`, with the signing secret in RESEND_WEBHOOK_SECRET. Events that
 * don't change the list are acknowledged and ignored.
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
    // A booking confirmation that bounces points at a fake booking. Swallows its own
    // errors so a push failure can't make Resend retry the opt-out above.
    if (action.source === "bounce") await flagBouncedBookings(action.emails);
    return okResponse();
  } catch (error) {
    // A 500 makes Resend retry the event later.
    console.error("[webhooks/resend] Opt-out failed:", error);
    return errorResponse("Couldn't record the opt-out.", 500);
  }
}
