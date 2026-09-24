// src/features/reviews/lib/email-invoice.ts
// Invoice, quote, reminder, payment-apology and void emails for the business ledger.

import { formatNZD } from "@/features/business/lib/business";
import {
  DEFAULT_INVOICE_EMAIL_BODY,
  DEFAULT_QUOTE_EMAIL_BODY,
  DEFAULT_VOID_EMAIL_BODY,
} from "@/features/business/lib/invoice-email-defaults";
import {
  brandName,
  buildEmailSignature,
  escapeHtml,
  htmlToText,
  linkifyEscaped,
  missingEmailEnv,
  renderDocumentEmail,
  sendOutreach,
} from "@/features/reviews/lib/email-core";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { formatDateShort } from "@/shared/lib/date-format";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";

/**
 * Subset of the Invoice row needed to render the email body.
 * Kept as a structural type so callers can pass a Prisma row directly without coupling.
 */
export interface InvoiceEmailData {
  number: string;
  clientName: string;
  clientEmail: string;
  issueDate: Date;
  dueDate: Date;
  total: number;
  driveWebUrl?: string | null;
  /** True when the row is a quote - switches subject/body to quote wording. */
  isQuote?: boolean | null;
  /** Quote validity end; shown in place of the due date. */
  quoteValidUntil?: Date | null;
}

interface BuildInvoiceEmailArgs {
  invoice: InvoiceEmailData;
  reviewUrl: string | null;
  greetingName?: string;
  customBody?: string;
}

/**
 * Renders the invoice email subject + HTML body without sending. Shared by
 * the preview modal and the send route so the preview matches what's sent.
 * @param args - Render inputs.
 * @param args.invoice - Invoice row fields needed for the body.
 * @param args.reviewUrl - Stable per-contact review URL, or null to omit.
 * @param args.greetingName - Optional greeting target (e.g. person inside a company).
 * @param args.customBody - Optional intro replacement (multi-line via pre-wrap).
 * @returns Subject + escaped HTML body.
 */
export async function buildInvoiceEmail({
  invoice,
  reviewUrl,
  greetingName,
  customBody,
}: BuildInvoiceEmailArgs): Promise<{ subject: string; html: string }> {
  const siteUrl = getSiteUrl();
  const identity = await getIdentity();
  const isQuote = invoice.isQuote === true;
  const defaultBody = isQuote ? DEFAULT_QUOTE_EMAIL_BODY : DEFAULT_INVOICE_EMAIL_BODY;
  const bodyText = (customBody ?? defaultBody).trim();
  // pre-wrap preserves line breaks the operator typed; escape first so the
  // body can never inject markup, then linkify so a typed URL is clickable.
  const safeBody = linkifyEscaped(escapeHtml(bodyText || defaultBody));
  // Greeting: caller-supplied override wins; otherwise fall back to the first
  // word of clientName. The Send modal lets the operator type the right name
  // per send, so there's no auto-detection of company vs person here.
  const trimmedOverride = greetingName?.trim();
  const greetingTarget =
    trimmedOverride || (invoice.clientName.split(" ")[0] || invoice.clientName).trim();
  const safeGreeting = escapeHtml(greetingTarget);
  const safeNumber = escapeHtml(invoice.number);
  const dueDate = escapeHtml(formatDateShort(invoice.dueDate));
  const totalLabel = escapeHtml(formatNZD(invoice.total));
  const driveLink = invoice.driveWebUrl
    ? `<p style="margin:0 0 16px;font-size:14px;color:#555">An online copy is also here: <a href="${escapeHtml(invoice.driveWebUrl)}" style="color:#43bccd">view ${isQuote ? "quote" : "invoice"}</a>.</p>`
    : "";
  // No review ask on a quote - the job hasn't happened yet.
  const reviewLine =
    reviewUrl && !isQuote
      ? `<p style="margin:24px 0 0;font-size:14px;color:#555">If you've got a moment, I'd love to hear how it went - you can <a href="${escapeHtml(reviewUrl)}" style="color:#43bccd">leave a quick review here</a>. It's anonymous if you'd prefer.</p>`
      : "";

  // Quote emails swap the due line for validity and drop the bank block -
  // payment details come with the invoice after acceptance.
  const dateLine = isQuote
    ? invoice.quoteValidUntil
      ? `<p style="margin:0"><strong>Valid until:</strong> ${escapeHtml(formatDateShort(invoice.quoteValidUntil))}</p>`
      : ""
    : `<p style="margin:0"><strong>Due:</strong> ${dueDate} (${identity.paymentTermsDays} days from issue)</p>`;
  const paymentBlock = isQuote
    ? ""
    : `<p style="margin:0 0 8px;font-size:14px;color:#333"><strong>Bank transfer:</strong></p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333">
      Payee: ${escapeHtml(identity.name)}<br />
      Account: <strong>${escapeHtml(identity.bankAccount)}</strong><br />
      Reference: <strong>${safeNumber}</strong>
    </p>`;

  // Append " Tech" to match the signature and body brand name, so the subject
  // and the rest of the same email show one consistent business name.
  const subject = isQuote
    ? `Your quote from ${brandName(identity)} (${invoice.number})`
    : `Your invoice from ${brandName(identity)} (${invoice.number})`;
  const html = renderDocumentEmail(`
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0c0a3e">Hi ${safeGreeting},</h1>

    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap">${safeBody}</p>

    <div style="margin:0 0 16px;padding:12px 16px;background:#f3f4f6;border-radius:8px;font-size:14px;color:#333">
      <p style="margin:0 0 4px"><strong>${isQuote ? "Quote" : "Invoice"}:</strong> ${safeNumber}</p>
      <p style="margin:0 0 4px"><strong>Total:</strong> ${totalLabel}</p>
      ${dateLine}
    </div>

    ${driveLink}

    ${paymentBlock}

    <p style="margin:0;font-size:14px;color:#333">Any questions, just reply.</p>

    ${reviewLine}

    ${await buildEmailSignature(siteUrl)}
`);

  return { subject, html };
}

interface SendInvoiceEmailArgs {
  invoice: InvoiceEmailData;
  pdfBytes: Uint8Array;
  reviewUrl: string | null;
  greetingName?: string;
  customBody?: string;
}

/**
 * Sends the rendered invoice email via Resend with the PDF attached.
 * Failures are caught and logged - never throws.
 * @param args - Send inputs.
 * @param args.invoice - Invoice row fields needed for the body.
 * @param args.pdfBytes - Raw PDF bytes returned by `generateInvoicePdf`.
 * @param args.reviewUrl - Stable per-contact review URL, or null to omit the review line.
 * @param args.greetingName - Optional greeting target (forwarded to {@link buildInvoiceEmail}).
 * @param args.customBody - Optional intro replacement.
 * @returns True if the email was accepted by Resend, false on failure or misconfig.
 */
export async function sendInvoiceEmail({
  invoice,
  pdfBytes,
  reviewUrl,
  greetingName,
  customBody,
}: SendInvoiceEmailArgs): Promise<boolean> {
  const from = process.env.EMAIL_FROM;
  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping invoice email.`,
    );
    return false;
  }
  if (!invoice.clientEmail) {
    console.warn(`[email] Invoice ${invoice.number} has no clientEmail - skipping send.`);
    return false;
  }

  const { subject, html } = await buildInvoiceEmail({
    invoice,
    reviewUrl,
    greetingName,
    customBody,
  });
  try {
    const result = await sendOutreach({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: invoice.clientEmail,
      subject,
      html,
      text: htmlToText(html),
      attachments: [
        {
          filename: `${invoice.isQuote ? "Quote" : "Invoice"} ${invoice.number}.pdf`,
          content: Buffer.from(pdfBytes),
        },
      ],
    });
    // A rejection comes back as { error }, not a throw; true would mark it sent.
    if (result.error) {
      console.error(`[email] Resend rejected invoice ${invoice.number}:`, result.error);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[email] Failed to send invoice ${invoice.number}:`, error);
    return false;
  }
}

interface SendInvoiceReminderEmailArgs {
  invoice: InvoiceEmailData;
  pdfBytes: Uint8Array;
  /** 1 for the first nudge, 2 for the second-and-final. Sets the tone. */
  reminderNumber: number;
}

/**
 * Sends an overdue-invoice nudge with the PDF attached. No review-link
 * machinery - chasing money and asking for a review don't mix. Never throws.
 * @param args - Send inputs.
 * @param args.invoice - Invoice row fields needed for the body.
 * @param args.pdfBytes - Raw PDF bytes (OVERDUE watermark already applied by the caller's generate).
 * @param args.reminderNumber - 1 or 2; the second says it's the last one.
 * @returns True if Resend accepted the message, false on failure or misconfig.
 */
export async function sendInvoiceReminderEmail({
  invoice,
  pdfBytes,
  reminderNumber,
}: SendInvoiceReminderEmailArgs): Promise<boolean> {
  const from = process.env.EMAIL_FROM;
  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping invoice reminder.`,
    );
    return false;
  }
  if (!invoice.clientEmail) {
    console.warn(`[email] Invoice ${invoice.number} has no clientEmail - skipping reminder.`);
    return false;
  }

  const siteUrl = getSiteUrl();
  const identity = await getIdentity();
  const { comms } = await getSettings();
  const greeting = escapeHtml((invoice.clientName.split(" ")[0] || invoice.clientName).trim());
  const safeNumber = escapeHtml(invoice.number);
  const dueDate = escapeHtml(formatDateShort(invoice.dueDate));
  const totalLabel = escapeHtml(formatNZD(invoice.total));
  const closing =
    reminderNumber >= comms.invoiceReminderMaxCount
      ? "This is the last automatic reminder I'll send. If something's holding payment up, just reply and we'll sort it out."
      : "If you've already paid in the last day or two, please ignore this - bank transfers can cross over.";

  const subject = `Friendly reminder - invoice ${invoice.number} (${totalLabel})`;
  const html = renderDocumentEmail(`
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0c0a3e">Hi ${greeting},</h1>

    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333">Just a friendly nudge - invoice ${safeNumber} was due on ${dueDate} and hasn't come through yet. A copy is attached.</p>

    <div style="margin:0 0 16px;padding:12px 16px;background:#f3f4f6;border-radius:8px;font-size:14px;color:#333">
      <p style="margin:0 0 4px"><strong>Invoice:</strong> ${safeNumber}</p>
      <p style="margin:0 0 4px"><strong>Amount due:</strong> ${totalLabel}</p>
      <p style="margin:0"><strong>Was due:</strong> ${dueDate}</p>
    </div>

    <p style="margin:0 0 8px;font-size:14px;color:#333"><strong>Bank transfer:</strong></p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333">
      Payee: ${escapeHtml(identity.name)}<br />
      Account: <strong>${escapeHtml(identity.bankAccount)}</strong><br />
      Reference: <strong>${safeNumber}</strong>
    </p>

    <p style="margin:0;font-size:14px;color:#333">${closing}</p>

    ${await buildEmailSignature(siteUrl)}
`);

  try {
    const result = await sendOutreach({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: invoice.clientEmail,
      subject,
      html,
      text: htmlToText(html),
      attachments: [
        {
          filename: `Invoice ${invoice.number}.pdf`,
          content: Buffer.from(pdfBytes),
        },
      ],
    });
    // A rejection comes back as { error }, not a throw; true would stamp it sent.
    if (result.error) {
      console.error(`[email] Resend rejected reminder for ${invoice.number}:`, result.error);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[email] Failed to send reminder for invoice ${invoice.number}:`, error);
    return false;
  }
}

interface SendPaymentApologyEmailArgs {
  invoice: InvoiceEmailData;
  /** When the reminder that shouldn't have gone out was sent. */
  reminderSentAt: Date;
  /** When the payment actually landed - always earlier than the reminder. */
  paidAt: Date;
}

/**
 * Apologises for chasing an invoice the client had already paid, sent when the
 * payment is finally recorded. Deliberately short and attachment-free - the
 * client already has the invoice, and a receipt would bury the apology. Never
 * throws.
 * @param args - Send inputs.
 * @param args.invoice - Invoice row fields needed for the body.
 * @param args.reminderSentAt - When the wrongly-sent reminder went out.
 * @param args.paidAt - When the payment actually landed.
 * @returns True if Resend accepted the message, false on failure or misconfig.
 */
export async function sendPaymentApologyEmail({
  invoice,
  reminderSentAt,
  paidAt,
}: SendPaymentApologyEmailArgs): Promise<boolean> {
  const from = process.env.EMAIL_FROM;
  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping payment apology.`,
    );
    return false;
  }
  if (!invoice.clientEmail) {
    console.warn(`[email] Invoice ${invoice.number} has no clientEmail - skipping apology.`);
    return false;
  }

  const siteUrl = getSiteUrl();
  const greeting = escapeHtml((invoice.clientName.split(" ")[0] || invoice.clientName).trim());
  const safeNumber = escapeHtml(invoice.number);
  const remindedOn = escapeHtml(formatDateShort(reminderSentAt));
  const paidOn = escapeHtml(formatDateShort(paidAt));
  const totalLabel = escapeHtml(formatNZD(invoice.total));

  const subject = `Sorry - invoice ${invoice.number} was already paid`;
  const html = renderDocumentEmail(`
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0c0a3e">Hi ${greeting},</h1>

    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333">I sent you a reminder about invoice ${safeNumber} on ${remindedOn}, but your payment had already come through on ${paidOn}. That one's on me - I hadn't marked it off yet.</p>

    <div style="margin:0 0 16px;padding:12px 16px;background:#f3f4f6;border-radius:8px;font-size:14px;color:#333">
      <p style="margin:0 0 4px"><strong>Invoice:</strong> ${safeNumber}</p>
      <p style="margin:0 0 4px"><strong>Amount:</strong> ${totalLabel}</p>
      <p style="margin:0"><strong>Paid:</strong> ${paidOn}</p>
    </div>

    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333">Nothing is owed, and you can ignore the reminder. Sorry for the chase.</p>

    <p style="margin:0;font-size:14px;color:#333">If anything doesn't look right, just reply.</p>

    ${await buildEmailSignature(siteUrl)}
`);

  try {
    // Resend SDK v3+ returns { data, error } instead of throwing on API-level
    // failures, so check error explicitly - a rejected send must leave
    // apologySentAt unstamped rather than reporting success.
    const result = await sendOutreach({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: invoice.clientEmail,
      subject,
      html,
      text: htmlToText(html),
    });
    if (result.error) {
      console.error(`[email] Resend rejected apology for ${invoice.number}:`, result.error);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[email] Failed to send apology for invoice ${invoice.number}:`, error);
    return false;
  }
}

interface BuildVoidEmailArgs {
  invoice: InvoiceEmailData;
  greetingName?: string;
  customBody?: string;
}

/**
 * Renders the "your invoice has been voided" email subject + body. Mirrors
 * {@link buildInvoiceEmail} but drops the bank-transfer block and review line - voided
 * invoices never request payment or a review.
 * @param args - Render inputs.
 * @param args.invoice - Invoice row fields needed for the body.
 * @param args.greetingName - Optional operator-typed greeting target.
 * @param args.customBody - Optional override; falls back to {@link DEFAULT_VOID_EMAIL_BODY}.
 * @returns Subject + escaped HTML body.
 */
export async function buildVoidEmail({
  invoice,
  greetingName,
  customBody,
}: BuildVoidEmailArgs): Promise<{
  subject: string;
  html: string;
}> {
  const siteUrl = getSiteUrl();
  const bodyText = (customBody ?? DEFAULT_VOID_EMAIL_BODY).trim();
  const safeBody = linkifyEscaped(escapeHtml(bodyText || DEFAULT_VOID_EMAIL_BODY));
  const trimmedOverride = greetingName?.trim();
  const greetingTarget =
    trimmedOverride || (invoice.clientName.split(" ")[0] || invoice.clientName).trim();
  const safeGreeting = escapeHtml(greetingTarget);
  const safeNumber = escapeHtml(invoice.number);
  const issueDate = escapeHtml(formatDateShort(invoice.issueDate));
  const totalLabel = escapeHtml(formatNZD(invoice.total));

  const subject = `Invoice ${invoice.number} - voided`;
  const html = renderDocumentEmail(`
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0c0a3e">Hi ${safeGreeting},</h1>

    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap">${safeBody}</p>

    <div style="margin:0 0 16px;padding:12px 16px;background:#f3f4f6;border-radius:8px;font-size:14px;color:#333">
      <p style="margin:0 0 4px"><strong>Voided invoice:</strong> ${safeNumber}</p>
      <p style="margin:0 0 4px"><strong>Original amount:</strong> ${totalLabel}</p>
      <p style="margin:0"><strong>Issued:</strong> ${issueDate}</p>
    </div>

    <p style="margin:0;font-size:14px;color:#333">Any questions, just reply.</p>

    ${await buildEmailSignature(siteUrl)}
`);

  return { subject, html };
}

interface SendVoidNotificationArgs {
  invoice: InvoiceEmailData;
  pdfBytes: Uint8Array;
  greetingName?: string;
  customBody?: string;
}

/**
 * Sends the void notification with the VOID-stamped PDF attached.
 * Logs + returns false on failure rather than throwing so the void endpoint
 * can report `notified: false` without rolling back the status change.
 * @param args - Send inputs.
 * @param args.invoice - Invoice row fields needed for the body.
 * @param args.pdfBytes - PDF bytes (already VOID-stamped).
 * @param args.greetingName - Optional greeting target.
 * @param args.customBody - Optional intro replacement.
 * @returns True if Resend accepted the email, false otherwise.
 */
export async function sendVoidNotification({
  invoice,
  pdfBytes,
  greetingName,
  customBody,
}: SendVoidNotificationArgs): Promise<boolean> {
  const from = process.env.EMAIL_FROM;
  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping void notification.`,
    );
    return false;
  }
  if (!invoice.clientEmail) {
    console.warn(
      `[email] Invoice ${invoice.number} has no clientEmail - skipping void notification.`,
    );
    return false;
  }

  const { subject, html } = await buildVoidEmail({ invoice, greetingName, customBody });
  try {
    // Resend SDK v3+ returns { data, error } instead of throwing on API-level
    // failures (invalid sender, rate limit, etc.). Check error explicitly so a
    // rejected call isn't silently reported as "Client notified".
    const result = await sendOutreach({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: invoice.clientEmail,
      subject,
      html,
      text: htmlToText(html),
      attachments: [
        {
          filename: `Invoice ${invoice.number} VOIDED.pdf`,
          content: Buffer.from(pdfBytes),
        },
      ],
    });
    if (result.error) {
      console.error(
        `[email] Resend rejected void notification for ${invoice.number}:`,
        result.error,
      );
      return false;
    }
    console.log(
      `[email] Void notification sent for ${invoice.number}:`,
      result.data?.id ?? "(no id returned)",
    );
    return true;
  } catch (error) {
    console.error(`[email] Failed to send void notification for ${invoice.number}:`, error);
    return false;
  }
}
