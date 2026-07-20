// src/app/api/cron/send-invoice-reminders/route.ts
/**
 * @description Cron that chases overdue SENT invoices - a polite nudge with the
 * (OVERDUE-watermarked) PDF attached, at most two per invoice. First reminder
 * at `invoiceReminderFirstDays` past due, second at `invoiceReminderSecondDays`,
 * then it stops chasing. Idempotent via Invoice.reminderCount, stamped only
 * after Resend accepts. Registered on cron-job.org (~daily) with the
 * `Authorization: Bearer CRON_SECRET` header - see docs/CRON.md.
 */

import { sendOverdueReminder } from "@/features/business/lib/invoice-reminders";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorized } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * GET /api/cron/send-invoice-reminders
 * @param request - Incoming cron request.
 * @returns JSON `{ ok, sent, skipped, failed, errors }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const { comms } = await getSettings();
    if (!comms.invoiceRemindersEnabled) {
      return NextResponse.json({ ok: true, skipped: "invoice reminders disabled", sent: 0 });
    }

    const now = new Date();
    // Coarse DB filter: SENT and at least first-offset days past due. The
    // per-invoice tier check below decides which reminder (if any) is due -
    // reminderCount can't be compared against in the same query cheaply
    // because null must read as 0.
    const firstThreshold = new Date(
      now.getTime() - comms.invoiceReminderFirstDays * 24 * 60 * 60 * 1000,
    );
    const candidates = await prisma.invoice.findMany({
      where: { status: "SENT", dueDate: { lte: firstThreshold } },
      orderBy: { dueDate: "asc" },
    });

    const results = { sent: 0, skipped: 0, failed: 0, errors: [] as string[] };

    for (const inv of candidates) {
      const count = inv.reminderCount ?? 0;
      // Max two reminders, ever - after the second the invoice is the
      // operator's problem, not the robot's.
      if (count >= 2) {
        results.skipped++;
        continue;
      }
      // The second nudge waits for its own (later) offset.
      if (count === 1) {
        const secondThreshold = new Date(
          now.getTime() - comms.invoiceReminderSecondDays * 24 * 60 * 60 * 1000,
        );
        if (inv.dueDate > secondThreshold) {
          results.skipped++;
          continue;
        }
      }

      const res = await sendOverdueReminder(inv);
      if (res.ok) {
        results.sent++;
        console.log(
          `[cron/send-invoice-reminders] sent reminder ${res.reminderNumber} for ${inv.number}`,
        );
      } else {
        results.failed++;
        results.errors.push(`${inv.number}: ${res.error ?? "unknown"}`);
      }
    }

    console.log(
      `[cron/send-invoice-reminders] done: ${results.sent} sent, ${results.skipped} skipped, ${results.failed} failed`,
    );
    return NextResponse.json({ ok: true, ...results });
  } catch (error) {
    console.error("[cron/send-invoice-reminders] Error:", error);
    return errorResponse("Internal error", 500);
  }
}
