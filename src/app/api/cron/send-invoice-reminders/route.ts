// src/app/api/cron/send-invoice-reminders/route.ts
// Daily cron chasing overdue SENT invoices: max two nudges per invoice at the
// comms-settings offsets, idempotent via reminderCount. See docs/CRON.md.

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
    // Coarse filter only - the per-invoice tier check decides what's due,
    // since reminderCount's null-reads-as-0 can't be queried cheaply.
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
      // Max two reminders ever - after that it's the operator's problem.
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
