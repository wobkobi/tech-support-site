// src/features/business/lib/invoice-reminders.ts
// Overdue-invoice reminder send-and-stamp, shared by the daily cron and the
// manual "Send reminder" action so the two paths cannot drift: same PDF, same
// email variant, same stamp-only-after-Resend-accepts rule.

import { generateInvoicePdf, serializeInvoice } from "@/features/business/lib/invoice-pdf";
import { sendInvoiceReminderEmail } from "@/features/reviews/lib/email";
import { prisma } from "@/shared/lib/prisma";
import type { Invoice as PrismaInvoice } from "@prisma/client";

/** Outcome of one reminder attempt. */
export interface ReminderSendResult {
  ok: boolean;
  /** Which reminder this was (1 or 2) when sent; unset on failure. */
  reminderNumber?: number;
  error?: string;
}

/**
 * Generates the invoice PDF (which carries the OVERDUE watermark for an
 * overdue SENT invoice), emails the polite nudge, and stamps
 * `reminderLastSentAt` / `reminderCount` ONLY after Resend accepts - the
 * booking-reminder idempotency pattern. Stamping first would silently drop the
 * reminder forever on a transient send failure; a rare duplicate (crash
 * between send and stamp) is recoverable, a never-sent chase is not.
 * @param invoice - The full invoice row (must be SENT and past due; callers gate).
 * @returns Whether the send happened and which reminder number it was.
 */
export async function sendOverdueReminder(invoice: PrismaInvoice): Promise<ReminderSendResult> {
  // Null reads as 0 (Mongo optional-field rule).
  const reminderNumber = (invoice.reminderCount ?? 0) + 1;

  let pdfBytes: Buffer;
  try {
    pdfBytes = await generateInvoicePdf(serializeInvoice(invoice));
  } catch (err) {
    console.error(`[invoice-reminders] PDF generation failed for ${invoice.number}:`, err);
    return { ok: false, error: "PDF generation failed" };
  }

  const accepted = await sendInvoiceReminderEmail({
    invoice: {
      number: invoice.number,
      clientName: invoice.clientName,
      clientEmail: invoice.clientEmail,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      total: invoice.total,
      driveWebUrl: invoice.driveWebUrl,
    },
    pdfBytes,
    reminderNumber,
  });
  if (!accepted) return { ok: false, error: "Email send failed" };

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { reminderLastSentAt: new Date(), reminderCount: reminderNumber },
  });

  return { ok: true, reminderNumber };
}
