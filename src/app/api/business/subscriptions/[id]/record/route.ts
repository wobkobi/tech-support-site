// src/app/api/business/subscriptions/[id]/record/route.ts
// Admin endpoint to record one subscription payment at the amount and date actually charged.
// Sheet-append failures are non-fatal (sheetSyncWarning); an already-claimed period returns 409.

import { recordSubscriptionPayment } from "@/features/business/lib/subscription-recording";
import { parseAmount, parseDate } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/business/subscriptions/[id]/record - Records one subscription payment.
 * Creates an ExpenseEntry, advances nextDue, and appends a row to the Expenses sheet. The
 * optional body `{ amountIncl, date }` (date as YYYY-MM-DD) overrides the saved amount and
 * today's date.
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

  // An empty body records at the saved amount, dated today.
  const body = (await request.json().catch(() => ({}))) as {
    amountIncl?: unknown;
    date?: unknown;
  };
  let amountIncl: number | undefined;
  if (body.amountIncl !== undefined) {
    const parsed = parseAmount(body.amountIncl);
    if (parsed === null) return errorResponse("Invalid amount", 400);
    amountIncl = parsed;
  }
  let on: Date | undefined;
  if (body.date !== undefined) {
    // UTC midnight of the given day, matching how every ledger date is stored.
    const parsed =
      typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
        ? parseDate(`${body.date}T00:00:00.000Z`)
        : null;
    if (parsed === null) return errorResponse("Invalid date", 400);
    on = parsed;
  }

  const { claimed, expense, nextDue, sheetSyncWarning } = await recordSubscriptionPayment(sub, {
    on,
    amountIncl,
  });
  // CAS lost: the cron or a double-click already recorded this period.
  if (!claimed) {
    return errorResponse("Already recorded for this period.", 409);
  }

  return NextResponse.json({ ok: true, expense, nextDue: nextDue.toISOString(), sheetSyncWarning });
}
