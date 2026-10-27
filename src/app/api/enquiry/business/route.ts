// src/app/api/enquiry/business/route.ts
// Public business enquiry: validate, then email the operator and, once that's gone, an ack to
// the enquirer (no DB).
// Outside /api/business/*, which is admin-guarded.

import { validateEmail } from "@/features/booking/lib/booking";
import {
  sendBusinessEnquiryAck,
  sendBusinessEnquiryNotification,
  type BusinessEnquiryData,
} from "@/features/reviews/lib/email-enquiry";
import { errorResponse } from "@/shared/lib/api-response";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { checkEmailDomain } from "@/shared/lib/email-domain.server";
import { normaliseEmail } from "@/shared/lib/normalise-email";
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
 * POST /api/enquiry/business - send the notification and ack emails.
 * @param request - Next.js request with the enquiry payload.
 * @returns JSON `{ ok }` or a 4xx error response.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "business-enquiry", 5, 60_000);
  if (limited) return limited;

  try {
    const body = (await request.json()) as BusinessEnquiryPayload;

    // Honeypot trip: fake success so the bot moves on.
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
    const email = normaliseEmail(body.email);
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
    if ((await checkEmailDomain(email)) === "no-mail") {
      return errorResponse(
        "That email address can't receive email. Please check it for typos.",
        400,
      );
    }
    if (!needs) return errorResponse("Please tell me what you need help with.", 400);
    if (needs.length > MAX_NEEDS) {
      return errorResponse("That message is a bit long - please trim it down.", 400);
    }

    const phoneValidation = validatePhone(body.phone ?? "", { nzOnly: true });
    if (phoneValidation.result === "invalid") {
      return errorResponse("Please enter a valid phone number, or leave it blank.", 400);
    }

    const enquiry: BusinessEnquiryData = {
      // Drop a company typed before the toggle flipped to personal.
      company: kind === "business" ? company : null,
      name,
      email,
      phone: phoneValidation.e164 || null,
      needs,
      interest: pickOption(body.interest, INTEREST_OPTIONS),
      urgency: pickOption(body.urgency, URGENCY_OPTIONS),
    };

    // The owner's email is the only record of the enquiry, so when it doesn't go the customer
    // is asked to try again (the form keeps what they typed) and gets no "got it" ack.
    const delivered = await sendBusinessEnquiryNotification(enquiry);
    if (!delivered) {
      const { phone } = await getIdentity().catch(() => ({ phone: "" }));
      return errorResponse(
        phone
          ? `Your enquiry couldn't be sent just now. Please try again in a minute, or call or text me on ${phone}.`
          : "Your enquiry couldn't be sent just now. Please try again in a minute.",
        502,
      );
    }
    await sendBusinessEnquiryAck(enquiry);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[enquiry/business] Failed:", error);
    return errorResponse("Something went wrong sending your enquiry. Please try again.", 500);
  }
}
