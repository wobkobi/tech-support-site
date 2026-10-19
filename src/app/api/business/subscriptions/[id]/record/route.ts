// src/app/api/business/subscriptions/[id]/record/route.ts
// Admin endpoint to record one subscription payment. Sheet-append failures are non-fatal
// (sheetSyncWarning); an already-claimed period returns 409.

import { recordSubscriptionPayment } from "@/features/business/lib/subscription-recording";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/business/subscriptions/[id]/record - Records one subscription payment.
 * Creates an ExpenseEntry, advances nextDue, and appends a row to the Expenses sheet.
 * @param request - Incoming Next.js request.
 * @param root0 - Route context.
 * @param root0.params - Route params promise.
 * @returns JSON with the created expense, new nextDue, and optional sheetSyncWarning.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;

  const sub = await prisma.subscription.findUnique({ where: { id } });
  if (!sub) {
    return errorResponse("Subscription not found", 404);
  }

  const { claimed, expense, nextDue, sheetSyncWarning } = await recordSubscriptionPayment(sub);
  // CAS lost: the cron or a double-click already recorded this period.
  if (!claimed) {
    return errorResponse("Already recorded for this period.", 409);
  }

  return NextResponse.json({ ok: true, expense, nextDue: nextDue.toISOString(), sheetSyncWarning });
}
