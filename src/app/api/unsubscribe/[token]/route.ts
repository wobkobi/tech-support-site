// src/app/api/unsubscribe/[token]/route.ts
// Public unsubscribe endpoint. Mail apps hit it directly through the List-Unsubscribe
// header (RFC 8058 one-click: a form POST with `List-Unsubscribe=One-Click`), and the
// /unsubscribe page posts JSON `{ action }` to it. POST only: link scanners fetch every
// URL in an email with GET, and that must never unsubscribe anyone.

import { optOutContact, resubscribeContact } from "@/features/mailing/lib/opt-out";
import { verifyUnsubscribeToken } from "@/features/mailing/lib/unsubscribe-token";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { NextRequest, NextResponse } from "next/server";

/** Token a test send carries, so its link works without touching a real contact. */
const PREVIEW_TOKEN = "preview";

/**
 * Works out what the caller wants. A JSON body is the page; anything else is a mail
 * app's one-click POST, which always means unsubscribe.
 * @param request - Incoming request.
 * @returns The requested action, or null for an unknown JSON action.
 */
async function readAction(request: NextRequest): Promise<"unsubscribe" | "resubscribe" | null> {
  if (!request.headers.get("content-type")?.includes("application/json")) return "unsubscribe";
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action === "unsubscribe" || body?.action === "resubscribe") return body.action;
  return null;
}

/**
 * POST /api/unsubscribe/[token]
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
  if (!action) return errorResponse('action must be "unsubscribe" or "resubscribe".', 400);
  if (token === PREVIEW_TOKEN) return okResponse();

  const contactId = verifyUnsubscribeToken(token);
  if (!contactId) return errorResponse("This unsubscribe link isn't valid.", 400);

  try {
    if (action === "resubscribe") {
      await resubscribeContact(contactId);
    } else {
      const isOneClick = !request.headers.get("content-type")?.includes("application/json");
      // A contact deleted since the email went out has nothing left to opt out.
      await optOutContact(contactId, isOneClick ? "one_click" : "link");
    }
    return okResponse();
  } catch (error) {
    console.error("[unsubscribe] Error:", error);
    return errorResponse("Something went wrong. Please try again.", 500);
  }
}
