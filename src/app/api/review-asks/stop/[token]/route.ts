// src/app/api/review-asks/stop/[token]/route.ts
// Public "stop asking me for reviews" endpoint. Mail apps hit it directly through the
// review-ask email's List-Unsubscribe header (RFC 8058 one-click: a form POST), and the
// /review-asks/stop page posts JSON `{ action }` to it. POST only: link scanners fetch
// every URL in an email with GET, and that must never opt anyone out.

import { verifyReviewAskStopToken } from "@/features/mailing/lib/unsubscribe-token";
import { allowReviewAsks, optOutOfReviewAsks } from "@/features/reviews/lib/review-ask-opt-out";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { NextRequest, NextResponse } from "next/server";

/** Token the admin preview carries, so its link works without touching a real contact. */
const PREVIEW_TOKEN = "preview";

/**
 * Works out what the caller wants. A JSON body is the page; anything else is a mail
 * app's one-click POST, which always means stop.
 * @param request - Incoming request.
 * @returns The requested action, or null for an unknown JSON action.
 */
async function readAction(request: NextRequest): Promise<"stop" | "allow" | null> {
  if (!request.headers.get("content-type")?.includes("application/json")) return "stop";
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action === "stop" || body?.action === "allow") return body.action;
  return null;
}

/**
 * POST /api/review-asks/stop/[token]
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the signed token.
 * @returns JSON `{ ok }`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const action = await readAction(request);
  if (!action) return errorResponse('action must be "stop" or "allow".', 400);
  if (token === PREVIEW_TOKEN) return okResponse();

  const contactId = verifyReviewAskStopToken(token);
  if (!contactId) return errorResponse("This link isn't valid.", 400);

  try {
    if (action === "allow") {
      await allowReviewAsks(contactId);
    } else {
      const isOneClick = !request.headers.get("content-type")?.includes("application/json");
      // A contact deleted since the email went out has nothing left to opt out.
      await optOutOfReviewAsks(contactId, isOneClick ? "one_click" : "link");
    }
    return okResponse();
  } catch (error) {
    console.error("[review-asks/stop] Error:", error);
    return errorResponse("Something went wrong. Please try again.", 500);
  }
}
