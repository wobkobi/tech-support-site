// src/app/api/cron/record-subscriptions/route.ts
// Cron (daily 8am NZ) that records every active subscription due today or earlier. A CAS
// on nextDue keeps concurrent runs idempotent.

import { recordSubscriptionPayment } from "@/features/business/lib/subscription-recording";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { nzTodayKey } from "@/shared/lib/timezone-utils";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/record-subscriptions
 * Records all active subscriptions due today or earlier (NZ time).
 * @param request - Incoming cron request.
 * @returns JSON with count of recorded subscriptions and any errors.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorised(request)) {
    return errorResponse("Unauthorized", 401);
  }

  // nextDue is stored as UTC midnight, so UTC midnight of today's NZ date is the ceiling.
  const todayNZ = new Date(`${nzTodayKey()}T00:00:00.000Z`);

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
