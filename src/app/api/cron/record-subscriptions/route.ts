// src/app/api/cron/record-subscriptions/route.ts
// Cron (daily 8am NZ) that reminds about due subscriptions with a push notification. It never
// records them: the charged amount can differ from the saved one, so the operator records each
// by hand with the real figure. The path keeps its old name so the cron-job.org job still hits it.

import { formatNZD } from "@/features/business/lib/business";
import { sendOwnerPush } from "@/features/notifications/lib/push";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { nzTodayKey } from "@/shared/lib/timezone-utils";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/record-subscriptions
 * Sends one push listing every active subscription due today or earlier (NZ time). Repeats
 * daily until each is recorded; the shared tag replaces yesterday's notification.
 * @param request - Incoming cron request.
 * @returns JSON with how many are due and what the push did.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorised(request)) {
    return errorResponse("Unauthorized", 401);
  }

  // nextDue is stored as UTC midnight, so UTC midnight of today's NZ date is the ceiling.
  const todayNZ = new Date(`${nzTodayKey()}T00:00:00.000Z`);

  const due = await prisma.subscription.findMany({
    where: { isActive: true, nextDue: { lte: todayNZ } },
    orderBy: { nextDue: "asc" },
  });
  if (due.length === 0) {
    return NextResponse.json({ ok: true, due: 0 });
  }

  const list = due.map((s) => `${s.description} (${formatNZD(s.amountIncl)})`).join(", ");
  const push = await sendOwnerPush({
    title:
      due.length === 1 ? `${due[0]!.description} is due` : `${due.length} subscriptions are due`,
    body: `${list}. Record what you were charged.`,
    url: "/admin/business/expenses#subscriptions",
    tag: "subscriptions-due",
  });

  return NextResponse.json({ ok: true, due: due.length, push });
}
