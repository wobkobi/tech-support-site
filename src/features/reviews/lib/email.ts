// src/features/reviews/lib/email.ts
/**
 * @file email.ts
 * @description Shared Resend utility for sending transactional emails.
 */

import { Resend } from "resend";
import {
  BUSINESS,
  BUSINESS_BANK_ACCOUNT,
  BUSINESS_PAYMENT_TERMS_DAYS,
} from "@/shared/lib/business-identity";
import { formatDateTimeLong, formatDateShort } from "@/shared/lib/date-format";
import { formatNZD } from "@/features/business/lib/business";
import { DEFAULT_INVOICE_EMAIL_BODY } from "@/features/business/lib/invoice-email-defaults";

/**
 * Escapes HTML special characters so user-supplied values can be safely
 * interpolated into HTML email bodies without breaking layout or injecting markup.
 * @param value - The string to escape.
 * @returns The escaped string.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders the standard email signature block (logo, name, role, phone, email,
 * site link, location). Trusted static content; no escaping needed.
 * @param siteUrl - Canonical site URL for the logo link and footer.
 * @returns HTML string for the signature.
 */
function buildEmailSignature(siteUrl: string): string {
  return `
    <div style="margin:32px 0 0;padding-top:24px;border-top:1px solid #e8e8e8">
      <a href="${siteUrl}" style="display:inline-block;margin-bottom:12px">
        <img src="${siteUrl}/assets/email-signature-400x135.png" alt="${BUSINESS.company} Tech" width="200" style="display:block;border:0;height:auto" />
      </a>
      <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#0c0a3e">${BUSINESS.name}</p>
      <p style="margin:0 0 10px;font-size:13px;color:#666">Owner &amp; Technician</p>
      <p style="margin:0 0 4px;font-size:13px;color:#555">📞 <a href="${BUSINESS.phoneTel}" style="color:#555;text-decoration:none">${BUSINESS.phone}</a></p>
      <p style="margin:0 0 4px;font-size:13px;color:#555">✉️ <a href="mailto:${BUSINESS.email}" style="color:#43bccd;text-decoration:none">${BUSINESS.email}</a></p>
      <p style="margin:0 0 4px;font-size:13px;color:#555">🌐 <a href="${siteUrl}" style="color:#43bccd;text-decoration:none">${siteUrl.replace(/^https?:\/\//, "")}</a></p>
      <p style="margin:0;font-size:12px;color:#999">${BUSINESS.location}</p>
    </div>`;
}

// Lazy singleton - created on first use so module import never throws in test environments.
let _resend: Resend | null = null;
/**
 * Returns the shared Resend client, initialising it on first call.
 * @returns Resend client instance.
 */
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

/**
 * Review data used for owner notification emails.
 */
export interface ReviewNotificationData {
  /** Review database ID */
  id: string;
  /** Review text content */
  text: string;
  /** Reviewer first name */
  firstName: string | null;
  /** Reviewer last name */
  lastName: string | null;
  /** Whether the reviewer posted anonymously */
  isAnonymous: boolean;
  /** Whether the review was verified via a booking token */
  verified: boolean;
}

/**
 * Sends the site owner a notification email when a new review is submitted.
 * Failures are caught and logged - never throws.
 * @param review - The newly submitted review.
 * @returns Promise that resolves when the email is sent (or silently fails).
 */
export async function sendOwnerReviewNotification(review: ReviewNotificationData): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const from = process.env.EMAIL_FROM;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz";

  if (!adminEmail || !from || !process.env.RESEND_API_KEY) {
    console.warn("[email] Resend not configured - skipping owner notification.");
    return;
  }

  const displayName = review.isAnonymous
    ? "Anonymous"
    : [review.firstName, review.lastName].filter(Boolean).join(" ") || "Unknown";

  const badge = review.verified ? "✅ Verified (auto-approved)" : "⏳ Pending approval";
  const adminUrl = `${siteUrl}/admin/reviews`;
  const safeDisplayName = escapeHtml(displayName);
  const safeReviewText = escapeHtml(review.text).replace(/\n/g, "<br>");

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h2 style="margin:0 0 8px;color:#0c0a3e;font-size:20px">New review submitted</h2>
    <p style="margin:0 0 20px;color:#555;font-size:14px">${badge}</p>

    <div style="background:#f6f7f8;border-radius:8px;padding:16px;margin-bottom:20px">
      <p style="margin:0 0 8px;font-size:14px;color:#888"><strong style="color:#0c0a3e">${safeDisplayName}</strong></p>
      <p style="margin:0;color:#222;line-height:1.6;font-size:15px">${safeReviewText}</p>
    </div>

    ${
      !review.verified
        ? `<a href="${adminUrl}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Review &amp; Approve →</a>`
        : `<p style="margin-top:12px;margin-bottom:0;color:#555;font-size:14px">This review has been verified.</p>`
    }
  </div>
</body>
</html>`;

  try {
    await getResend().emails.send({
      from,
      replyTo: adminEmail,
      to: adminEmail,
      subject: `New review - ${displayName} (${review.verified ? "verified" : "pending"})`,
      html,
    });
  } catch (error) {
    console.error("[email] Failed to send owner review notification:", error);
  }
}

/**
 * Booking data used for owner/customer booking emails.
 */
export interface BookingNotificationData {
  /** Booking ID */
  id: string;
  /** Customer name */
  name: string;
  /** Customer email */
  email: string;
  /** Formatted notes (includes time slot, duration, meeting type, address, phone, description) */
  notes: string;
  /** Appointment start (UTC) */
  startAt: Date;
  /** Appointment end (UTC) */
  endAt: Date;
  /** Cancel token for the cancel link */
  cancelToken: string;
}

/**
 * Sends the site owner a notification email when a new booking is submitted.
 * Failures are caught and logged - never throws.
 * @param booking - The new booking details.
 * @returns Promise that resolves when the email is sent (or silently fails).
 */
export async function sendOwnerBookingNotification(
  booking: BookingNotificationData,
): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const from = process.env.EMAIL_FROM;

  if (!adminEmail || !from || !process.env.RESEND_API_KEY) {
    console.warn("[email] Resend not configured - skipping owner booking notification.");
    return;
  }

  const start = formatDateTimeLong(booking.startAt);
  const notesHtml = escapeHtml(booking.notes).replace(/\n/g, "<br>");
  const safeName = escapeHtml(booking.name);
  const safeEmail = escapeHtml(booking.email);
  const safeMailto = encodeURIComponent(booking.email);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h2 style="margin:0 0 4px;color:#0c0a3e;font-size:20px">New booking</h2>
    <p style="margin:0 0 20px;color:#555;font-size:14px">${start}</p>

    <div style="background:#f6f7f8;border-radius:8px;padding:16px;margin-bottom:20px">
      <p style="margin:0 0 4px;font-size:14px;color:#888">Customer</p>
      <p style="margin:0 0 12px;font-size:15px;color:#0c0a3e;font-weight:600">${safeName}</p>
      <p style="margin:0 0 12px;font-size:14px;color:#444"><a href="mailto:${safeMailto}" style="color:#43bccd">${safeEmail}</a></p>
      <p style="margin:0;font-size:14px;color:#444;line-height:1.6">${notesHtml}</p>
    </div>
  </div>
</body>
</html>`;

  try {
    await getResend().emails.send({
      from,
      replyTo: adminEmail,
      to: adminEmail,
      subject: `New booking - ${booking.name} (${start})`,
      html,
    });
  } catch (error) {
    console.error("[email] Failed to send owner booking notification:", error);
  }
}

/**
 * Sends the customer a booking confirmation email with their appointment details and cancel link.
 * Failures are caught and logged - never throws.
 * @param booking - The new booking details.
 * @returns Promise that resolves when the email is sent (or silently fails).
 */
export async function sendCustomerBookingConfirmation(
  booking: BookingNotificationData,
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz";

  if (!from || !process.env.RESEND_API_KEY) {
    console.warn("[email] Resend not configured - skipping customer booking confirmation.");
    return;
  }

  const firstName = booking.name.split(" ")[0];
  const safeFirstName = escapeHtml(firstName);
  const start = formatDateTimeLong(booking.startAt);
  const cancelUrl = `${siteUrl}/booking/cancel?token=${encodeURIComponent(booking.cancelToken)}`;
  const notesHtml = escapeHtml(booking.notes).replace(/\n/g, "<br>");

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h2 style="margin:0 0 12px;color:#0c0a3e;font-size:20px">Booking confirmed, ${safeFirstName}!</h2>
    <p style="margin:0 0 20px;color:#444;line-height:1.6">Thanks for choosing To The Point Tech - I'm looking forward to helping you out.</p>

    <p style="margin:0 0 8px;color:#888;font-size:13px;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Your appointment</p>
    <p style="margin:0 0 20px;font-size:16px;font-weight:600;color:#0c0a3e">${start}</p>

    <div style="background:#f6f7f8;border-radius:8px;padding:16px;margin-bottom:24px">
      <p style="margin:0;font-size:14px;color:#444;line-height:1.6">${notesHtml}</p>
    </div>

    <p style="margin:0 0 20px;color:#444;font-size:14px;line-height:1.6">
      A Google Calendar invite has been sent to this address. If you need to change the time, you can <strong>propose a new time</strong> directly from the calendar invite, or just reply to this email and we'll sort something out.
    </p>

    <a href="${cancelUrl}" style="display:inline-block;background:#e8e8e8;color:#333;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600">Cancel appointment</a>
${buildEmailSignature(siteUrl)}
  </div>
</body>
</html>`;

  try {
    await getResend().emails.send({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: booking.email,
      subject: `Booking confirmed - ${start}`,
      html,
    });
  } catch (error) {
    console.error(`[email] Failed to send booking confirmation for booking ${booking.id}:`, error);
  }
}

/**
 * Booking data used for customer review request emails.
 */
export interface ReviewRequestData {
  /** Booking ID or ReviewRequest ID */
  id: string;
  /** Customer name */
  name: string;
  /** Customer email address */
  email: string;
  /** Unique review token */
  reviewToken: string;
}

/**
 * Sends a review request email to a customer shortly after their appointment.
 * Used by the cron job (30 min after visit). Failures are caught and logged - never throws.
 * @param booking - Booking details for the customer.
 * @returns Promise that resolves when the email is sent (or silently fails).
 */
export async function sendCustomerReviewRequest(booking: ReviewRequestData): Promise<void> {
  const from = process.env.EMAIL_FROM;
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz").replace(
    /\/$/,
    "",
  );

  if (!from || !process.env.RESEND_API_KEY) {
    console.warn("[email] Resend not configured - skipping customer review request.");
    return;
  }

  const reviewUrl = `${siteUrl}/review?token=${encodeURIComponent(booking.reviewToken)}`;
  const firstName = booking.name.split(" ")[0];
  const safeFirstName = escapeHtml(firstName);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h2 style="margin:0 0 12px;color:#0c0a3e;font-size:20px">Hi ${safeFirstName}, how did everything go?</h2>
    <p style="margin:0 0 12px;color:#444;line-height:1.6">It was great meeting you - I hope I managed to get everything sorted and left you feeling a bit less frustrated with technology!</p>
    <p style="margin:0 0 12px;color:#444;line-height:1.6">If you have a spare moment, I'd love to hear how your experience was. A quick review makes a real difference for a small local business like mine, and helps other people in the area find reliable tech support when they need it.</p>
    <p style="margin:0 0 24px;color:#444;line-height:1.6">It only takes a minute - and honest feedback is always welcome.</p>
    <a href="${reviewUrl}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px">Share your experience →</a>

    <p style="margin:28px 0 20px;color:#444;font-size:14px;line-height:1.6">Thanks again for choosing ${BUSINESS.company} Tech. If you ever need a hand with anything else, don't hesitate to get in touch.</p>
${buildEmailSignature(siteUrl)}
  </div>
</body>
</html>`;

  try {
    await getResend().emails.send({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: booking.email,
      subject: `Thanks for having me, ${firstName} - how did everything go?`,
      html,
    });
  } catch (error) {
    console.error(`[email] Failed to send review request for booking ${booking.id}:`, error);
  }
}

/**
 * Builds the HTML body for a past-client review request email.
 * @param firstName - Customer's first name.
 * @param reviewUrl - The personalised review link URL.
 * @returns HTML string ready to send.
 */
export function buildPastClientReviewEmailHtml(firstName: string, reviewUrl: string): string {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz").replace(
    /\/$/,
    "",
  );
  const safeFirstName = escapeHtml(firstName);
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h2 style="margin:0 0 12px;color:#0c0a3e;font-size:20px">Hi ${safeFirstName},</h2>
    <p style="margin:0 0 12px;color:#444;line-height:1.6">It's ${BUSINESS.name.split(" ")[0]} from ${BUSINESS.company} Tech - thanks again for letting me help you out!</p>
    <p style="margin:0 0 12px;color:#444;line-height:1.6">I'm in the process of updating my website and building up my reviews section. If you have a spare moment, a quick review would mean a lot - it really helps other people in the area find reliable local tech support.</p>
    <p style="margin:0 0 24px;color:#444;line-height:1.6">No pressure at all, but if you're happy to, I'd really appreciate it.</p>
    <a href="${reviewUrl}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px">Leave a review →</a>

    <p style="margin:28px 0 20px;color:#444;font-size:14px;line-height:1.6">If you ever need a hand with anything else, don't hesitate to get in touch.</p>
${buildEmailSignature(siteUrl)}
  </div>
</body>
</html>`;
}

/**
 * Sends a review request email to a past client (admin-triggered).
 * Tone is tailored for clients who were seen days/weeks ago, mentioning
 * the site update and asking for a review. Failures are caught and logged.
 * @param booking - Past client details.
 * @returns Promise that resolves when the email is sent (or silently fails).
 */
export async function sendPastClientReviewRequest(booking: ReviewRequestData): Promise<void> {
  const from = process.env.EMAIL_FROM;
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz").replace(
    /\/$/,
    "",
  );

  if (!from || !process.env.RESEND_API_KEY) {
    console.warn("[email] Resend not configured - skipping past client review request.");
    return;
  }

  const reviewUrl = `${siteUrl}/review?token=${encodeURIComponent(booking.reviewToken)}`;
  const firstName = booking.name.split(" ")[0];
  const html = buildPastClientReviewEmailHtml(firstName, reviewUrl);

  try {
    await getResend().emails.send({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: booking.email,
      subject: `Hi ${firstName}, it's Harrison from To The Point Tech`,
      html,
    });
  } catch (error) {
    console.error(
      `[email] Failed to send past client review request for request ${booking.id}:`,
      error,
    );
  }
}

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
}

/**
 * Renders the invoice email subject + HTML body without sending. Used by the
 * preview modal AND the send route so what the operator previews is exactly
 * what the customer receives.
 * @param args - Render inputs.
 * @param args.invoice - Invoice row fields needed for the body.
 * @param args.reviewUrl - Stable per-contact review URL, or null to omit the review line.
 * @param args.greetingName - Optional operator-typed greeting target. Useful when
 *   the invoice goes to a company but the email goes to a specific person (e.g.
 *   "Vicky" while the invoice header reads "Mars Salt and Sweet Limited").
 * @param args.customBody - Optional operator-typed message that replaces the
 *   default intro paragraph. Multi-line allowed (rendered with `white-space:
 *   pre-wrap` so line breaks are preserved). Falls back to
 *   DEFAULT_INVOICE_EMAIL_BODY when omitted.
 * @returns Subject + escaped HTML body.
 */
export function buildInvoiceEmail(args: {
  invoice: InvoiceEmailData;
  reviewUrl: string | null;
  greetingName?: string;
  customBody?: string;
}): { subject: string; html: string } {
  const { invoice, reviewUrl, greetingName, customBody } = args;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz";
  const bodyText = (customBody ?? DEFAULT_INVOICE_EMAIL_BODY).trim();
  // pre-wrap preserves line breaks the operator typed; escape first so the
  // body can never inject markup.
  const safeBody = escapeHtml(bodyText || DEFAULT_INVOICE_EMAIL_BODY);
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
    ? `<p style="margin:0 0 16px;font-size:14px;color:#555">An online copy is also here: <a href="${escapeHtml(invoice.driveWebUrl)}" style="color:#43bccd">view invoice</a>.</p>`
    : "";
  const reviewLine = reviewUrl
    ? `<p style="margin:24px 0 0;font-size:14px;color:#555">If you've got a moment, I'd love to hear how it went: <a href="${escapeHtml(reviewUrl)}" style="color:#43bccd">share your experience</a>. Quick and anonymous if you prefer.</p>`
    : "";

  const subject = `Your invoice from ${BUSINESS.company} (${invoice.number})`;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0c0a3e;background:#f6f7f8">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0c0a3e">Hi ${safeGreeting},</h1>

    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap">${safeBody}</p>

    <div style="margin:0 0 16px;padding:12px 16px;background:#f3f4f6;border-radius:8px;font-size:14px;color:#333">
      <p style="margin:0 0 4px"><strong>Invoice:</strong> ${safeNumber}</p>
      <p style="margin:0 0 4px"><strong>Total:</strong> ${totalLabel}</p>
      <p style="margin:0"><strong>Due:</strong> ${dueDate} (${BUSINESS_PAYMENT_TERMS_DAYS} days from issue)</p>
    </div>

    ${driveLink}

    <p style="margin:0 0 8px;font-size:14px;color:#333"><strong>Bank transfer:</strong></p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333">
      Payee: ${escapeHtml(BUSINESS.name)}<br />
      Account: <strong>${escapeHtml(BUSINESS_BANK_ACCOUNT)}</strong><br />
      Reference: <strong>${safeNumber}</strong>
    </p>

    <p style="margin:0;font-size:14px;color:#333">Any questions, just reply.</p>

    ${reviewLine}

    ${buildEmailSignature(siteUrl)}
  </div>
</body>
</html>`;

  return { subject, html };
}

/**
 * Sends the rendered invoice email via Resend with the PDF attached.
 * Failures are caught and logged - never throws.
 * @param args - Send inputs.
 * @param args.invoice - Invoice row fields needed for the body.
 * @param args.pdfBytes - Raw PDF bytes returned by `generateInvoicePdf`.
 * @param args.reviewUrl - Stable per-contact review URL, or null to omit the review line.
 * @param args.greetingName - Optional operator-typed greeting target (forwarded to buildInvoiceEmail).
 * @param args.customBody - Optional operator-typed message body that replaces the default intro paragraph.
 * @returns True if the email was accepted by Resend, false on failure or misconfig.
 */
export async function sendInvoiceEmail(args: {
  invoice: InvoiceEmailData;
  pdfBytes: Uint8Array;
  reviewUrl: string | null;
  greetingName?: string;
  customBody?: string;
}): Promise<boolean> {
  const { invoice, pdfBytes, reviewUrl, greetingName, customBody } = args;
  const from = process.env.EMAIL_FROM;
  if (!from || !process.env.RESEND_API_KEY) {
    console.warn("[email] Resend not configured - skipping invoice email.");
    return false;
  }
  if (!invoice.clientEmail) {
    console.warn(`[email] Invoice ${invoice.number} has no clientEmail - skipping send.`);
    return false;
  }

  const { subject, html } = buildInvoiceEmail({ invoice, reviewUrl, greetingName, customBody });
  try {
    await getResend().emails.send({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: invoice.clientEmail,
      subject,
      html,
      attachments: [
        {
          filename: `Invoice ${invoice.number}.pdf`,
          content: Buffer.from(pdfBytes),
        },
      ],
    });
    return true;
  } catch (error) {
    console.error(`[email] Failed to send invoice ${invoice.number}:`, error);
    return false;
  }
}
