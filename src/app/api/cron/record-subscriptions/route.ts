// src/app/api/cron/record-subscriptions/route.ts
/**
 * @description Cron endpoint (Bearer-authorised) that records every active
 * subscription due today or earlier in NZ time. GET creates an ExpenseEntry per
 * subscription, advances nextDue with a CAS guard so concurrent runs stay
 * idempotent, and appends each row to the Expenses Google Sheet. Run daily at
 * 8am NZ time via cron-job.org.
 */

import { recordSubscriptionPayment } from "@/features/business/lib/subscription-recording";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorized } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { nzTodayKey } from "@/shared/lib/timezone-utils";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * GET /api/cron/record-subscriptions
 * Records all active subscriptions due today or earlier (NZ time).
 * Run daily at 8am NZ time via cron-job.org.
 * @param request - Incoming cron request.
 * @returns JSON with count of recorded subscriptions and any errors.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return errorResponse("Unauthorized", 401);
  }

  // nextDue is stored as UTC midnight (admin form + advanceNextDue), so UTC
  // midnight of today's NZ date is the correct ceiling for `nextDue <=`.
  const todayNZ = new Date(`${nzTodayKey()}T00:00:00.000Z`);

  // Find subscriptions due today
  const due = await prisma.subscription.findMany({
    where: { isActive: true, nextDue: { lte: todayNZ } },
  });

  const recorded: string[] = [];
  const errors: string[] = [];

  const skipped: string[] = [];

  for (const sub of due) {
    try {
      const { claimed } = await recordSubscriptionPayment(sub, todayNZ);
      if (!claimed) {
        skipped.push(sub.id);
        continue;
      }
      recorded.push(sub.id);
    } catch (err) {
      console.error(`[cron/record-subscriptions] Failed to record ${sub.id}:`, err);
      errors.push(`${sub.description}: ${String(err)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    recorded: recorded.length,
    skipped: skipped.length,
    errors,
  });
}
