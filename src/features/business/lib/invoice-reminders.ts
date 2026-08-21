// src/features/business/lib/invoice-reminders.ts - overdue-reminder
// send-and-stamp shared by the daily cron and the manual action, plus the
// apology for a reminder that chased an already-paid invoice.

import { generateInvoicePdf, serializeInvoice } from "@/features/business/lib/invoice-pdf";
import { sendInvoiceReminderEmail, sendPaymentApologyEmail } from "@/features/reviews/lib/email";
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
 * Emails the nudge (OVERDUE-watermarked PDF attached) and stamps the reminder
 * fields ONLY after Resend accepts - stamping first would silently drop the
 * chase forever on a transient send failure.
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

/**
 * Emails the "sorry, you'd already paid" note and stamps `apologySentAt` only
 * once Resend accepts, so a transient failure leaves the invoice eligible for a
 * later attempt instead of silently swallowing the apology. Callers gate on
 * reminderChasedPaidInvoice (invoice-apology.ts) and the comms setting first.
 * @param invoice - The invoice row that was wrongly chased.
 * @param paidAt - The recorded payment date (earlier than the last reminder).
 * @returns True when the apology was sent and stamped.
 */
export async function sendReminderApology(invoice: PrismaInvoice, paidAt: Date): Promise<boolean> {
  if (!invoice.reminderLastSentAt) return false;

  const accepted = await sendPaymentApologyEmail({
    invoice: {
      number: invoice.number,
      clientName: invoice.clientName,
      clientEmail: invoice.clientEmail,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      total: invoice.total,
    },
    reminderSentAt: invoice.reminderLastSentAt,
    paidAt,
  });
  if (!accepted) return false;

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { apologySentAt: new Date() },
  });

  return true;
}
