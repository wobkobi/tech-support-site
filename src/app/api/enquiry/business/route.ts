// src/app/api/enquiry/business/route.ts
/**
 * @description Public business enquiry endpoint. Validates the form payload,
 * then emails the operator a notification and the enquirer an acknowledgement.
 * Email-only - no DB record is written. Deliberately outside /api/business/*,
 * which is the admin-guarded namespace.
 */

import { validateEmail } from "@/features/booking/lib/booking";
import {
  sendBusinessEnquiryAck,
  sendBusinessEnquiryNotification,
  type BusinessEnquiryData,
} from "@/features/reviews/lib/email";
import { errorResponse } from "@/shared/lib/api-response";
import { validatePhone } from "@/shared/lib/normalise-phone";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

/** Optional select values accepted from the form; anything else is dropped. */
const INTEREST_OPTIONS = ["One-off job", "Monthly retainer", "Not sure yet"] as const;
const URGENCY_OPTIONS = ["This week", "This month", "Just exploring"] as const;

/** Generous free-text ceilings so a pasted brief fits but abuse doesn't. */
const MAX_SHORT_FIELD = 200;
const MAX_NEEDS = 4000;

interface BusinessEnquiryPayload {
  /** "business" (default; company required) or "personal" (company omitted). */
  kind?: string;
  company?: string;
  name?: string;
  email?: string;
  phone?: string;
  needs?: string;
  interest?: string;
  urgency?: string;
  /** Honeypot field - real users never fill this; bots usually do. */
  website?: string;
}

/**
 * Narrows an optional select value to one of the allowed options, or null.
 * @param value - Raw value from the payload.
 * @param options - Allowed option strings.
 * @returns The matched option, or null.
 */
function pickOption(value: unknown, options: readonly string[]): string | null {
  return typeof value === "string" && options.includes(value) ? value : null;
}

/**
 * POST /api/enquiry/business - accepts a business enquiry and sends the
 * notification + ack emails.
 * @param request - Next.js request with the enquiry payload.
 * @returns JSON `{ ok }` or a 4xx error response.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "business-enquiry", 5, 60_000);
  if (limited) return limited;

  try {
    const body = (await request.json()) as BusinessEnquiryPayload;

    // Honeypot trip: silently report success without sending anything so the
    // bot moves on. Real users never fill this field (it's visually hidden
    // and tab-skipped on the form).
    if (typeof body.website === "string" && body.website.trim().length > 0) {
      console.warn("[enquiry/business] Honeypot tripped; faking success.", {
        ip: request.headers.get("x-forwarded-for") ?? "unknown",
      });
      return NextResponse.json({ ok: true });
    }

    // Unknown kinds collapse to business (the stricter validation path).
    const kind = body.kind === "personal" ? "personal" : "business";
    const company = body.company?.trim() ?? "";
    const name = body.name?.trim() ?? "";
    const email = body.email?.trim() ?? "";
    const needs = body.needs?.trim() ?? "";

    if (kind === "business" && !company) {
      return errorResponse("Please enter your company or trading name.", 400);
    }
    if (!name) return errorResponse("Please enter your name.", 400);
    if (company.length > MAX_SHORT_FIELD || name.length > MAX_SHORT_FIELD) {
      return errorResponse("Name fields are too long.", 400);
    }
    if (validateEmail(email) !== "ok") {
      return errorResponse("Please enter a valid email address.", 400);
    }
    if (!needs) return errorResponse("Please tell me what you need help with.", 400);
    if (needs.length > MAX_NEEDS) {
      return errorResponse("That message is a bit long - please trim it down.", 400);
    }

    const phoneValidation = validatePhone(body.phone ?? "");
    if (phoneValidation.result === "invalid") {
      return errorResponse("Please enter a valid phone number, or leave it blank.", 400);
    }

    const enquiry: BusinessEnquiryData = {
      // Personal enquiries carry no company even if one was typed then the
      // toggle flipped - the kind is what the visitor last chose.
      company: kind === "business" ? company : null,
      name,
      email,
      phone: phoneValidation.e164 || null,
      needs,
      interest: pickOption(body.interest, INTEREST_OPTIONS),
      urgency: pickOption(body.urgency, URGENCY_OPTIONS),
    };

    // Both senders warn-and-skip when email env is unconfigured - the enquiry
    // still reports success so the visitor isn't shown an error they can't fix.
    await Promise.all([sendBusinessEnquiryNotification(enquiry), sendBusinessEnquiryAck(enquiry)]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[enquiry/business] Failed:", error);
    return errorResponse("Something went wrong sending your enquiry. Please try again.", 500);
  }
}
