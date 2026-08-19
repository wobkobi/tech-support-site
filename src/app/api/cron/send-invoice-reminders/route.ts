// src/app/api/cron/send-invoice-reminders/route.ts
// Daily cron chasing overdue SENT invoices: up to the configured max nudges per
// invoice at the comms-settings offsets, idempotent via reminderCount. An
// invoice whose payment is already sitting in the income ledger is held back
// rather than chased. See docs/CRON.md.

import { findRecordedPayment } from "@/features/business/lib/invoice-payment-match";
import { sendOverdueReminder } from "@/features/business/lib/invoice-reminders";
import { NOT_A_QUOTE_FILTER } from "@/features/business/lib/invoice-status";
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
 * @returns JSON `{ ok, sent, skipped, paid, failed, errors }`.
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
      // A SENT quote has a placeholder dueDate, not a payment deadline -
      // never remind on quotes.
      where: { status: "SENT", dueDate: { lte: firstThreshold }, ...NOT_A_QUOTE_FILTER },
      orderBy: { dueDate: "asc" },
    });

    const results = { sent: 0, skipped: 0, paid: 0, failed: 0, errors: [] as string[] };

    for (const inv of candidates) {
      const count = inv.reminderCount ?? 0;
      // Stop once the configured max is reached - after that it's the operator's problem.
      if (count >= comms.invoiceReminderMaxCount) {
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

      // The money may already be in, entered straight into the Cashbook sheet
      // rather than against the invoice. Chasing someone who has paid is worse
      // than a nudge arriving late, so hold off and let the operator confirm -
      // the invoice page shows the same match with a prompt to record it.
      const payment = await findRecordedPayment(inv);
      if (payment) {
        results.paid++;
        console.warn(
          `[cron/send-invoice-reminders] ${inv.number} not chased: ${payment.strength} payment of ${payment.amount} on ${payment.date.toISOString()} - mark it paid`,
        );
        continue;
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
      `[cron/send-invoice-reminders] done: ${results.sent} sent, ${results.skipped} skipped, ${results.paid} already paid, ${results.failed} failed`,
    );
    return NextResponse.json({ ok: true, ...results });
  } catch (error) {
    console.error("[cron/send-invoice-reminders] Error:", error);
    return errorResponse("Internal error", 500);
  }
}
