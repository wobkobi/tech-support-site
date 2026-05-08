// src/features/reviews/lib/email.ts
/**
 * @file email.ts
 * @description Shared Resend utility for sending transactional emails.
 */

import { Resend } from "resend";

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
 * Formats a UTC date as a human-readable NZ local time string.
 * @param date - UTC date to format.
 * @returns Formatted date/time string in NZ time.
 */
function formatNZDateTime(date: Date): string {
  return date.toLocaleString("en-NZ", {
    timeZone: "Pacific/Auckland",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
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

  const start = formatNZDateTime(booking.startAt);
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
  const start = formatNZDateTime(booking.startAt);
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

    <div style="margin:32px 0 0;padding-top:24px;border-top:1px solid #e8e8e8">
      <a href="${siteUrl}" style="display:inline-block;margin-bottom:12px">
        <img src="${siteUrl}/assets/email-signature-400x135.png" alt="To The Point Tech" width="200" style="display:block;border:0;height:auto" />
      </a>
      <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#0c0a3e">Harrison Raynes</p>
      <p style="margin:0 0 10px;font-size:13px;color:#666">Owner &amp; Technician</p>
      <p style="margin:0 0 4px;font-size:13px;color:#555">📞 <a href="tel:+64212971237" style="color:#555;text-decoration:none">021 297 1237</a></p>
      <p style="margin:0 0 4px;font-size:13px;color:#555">✉️ <a href="mailto:harrison@tothepoint.co.nz" style="color:#43bccd;text-decoration:none">harrison@tothepoint.co.nz</a></p>
      <p style="margin:0 0 4px;font-size:13px;color:#555">🌐 <a href="${siteUrl}" style="color:#43bccd;text-decoration:none">tothepoint.co.nz</a></p>
      <p style="margin:0;font-size:12px;color:#999">Auckland, New Zealand</p>
    </div>
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

    <p style="margin:28px 0 20px;color:#444;font-size:14px;line-height:1.6">Thanks again for choosing To The Point Tech. If you ever need a hand with anything else, don't hesitate to get in touch.</p>

    <div style="padding-top:20px;border-top:1px solid #e8e8e8">
      <a href="${siteUrl}" style="display:inline-block;margin-bottom:12px">
        <img src="${siteUrl}/assets/email-signature-400x135.png" alt="To The Point Tech" width="200" style="display:block;border:0;height:auto" />
      </a>
      <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#0c0a3e">Harrison Raynes</p>
      <p style="margin:0 0 10px;font-size:13px;color:#666">Owner &amp; Technician</p>
      <p style="margin:0 0 4px;font-size:13px;color:#555">📞 <a href="tel:+64212971237" style="color:#555;text-decoration:none">021 297 1237</a></p>
      <p style="margin:0 0 4px;font-size:13px;color:#555">✉️ <a href="mailto:harrison@tothepoint.co.nz" style="color:#43bccd;text-decoration:none">harrison@tothepoint.co.nz</a></p>
      <p style="margin:0 0 4px;font-size:13px;color:#555">🌐 <a href="https://tothepoint.co.nz" style="color:#43bccd;text-decoration:none">tothepoint.co.nz</a></p>
      <p style="margin:0;font-size:12px;color:#999">Auckland, New Zealand</p>
    </div>
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
    <p style="margin:0 0 12px;color:#444;line-height:1.6">It's Harrison from To The Point Tech - thanks again for letting me help you out!</p>
    <p style="margin:0 0 12px;color:#444;line-height:1.6">I'm in the process of updating my website and building up my reviews section. If you have a spare moment, a quick review would mean a lot - it really helps other people in the area find reliable local tech support.</p>
    <p style="margin:0 0 24px;color:#444;line-height:1.6">No pressure at all, but if you're happy to, I'd really appreciate it.</p>
    <a href="${reviewUrl}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px">Leave a review →</a>

    <p style="margin:28px 0 20px;color:#444;font-size:14px;line-height:1.6">If you ever need a hand with anything else, don't hesitate to get in touch.</p>

    <div style="padding-top:20px;border-top:1px solid #e8e8e8">
      <a href="${siteUrl}" style="display:inline-block;margin-bottom:12px">
        <img src="${siteUrl}/assets/email-signature-400x135.png" alt="To The Point Tech" width="200" style="display:block;border:0;height:auto" />
      </a>
      <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#0c0a3e">Harrison Raynes</p>
      <p style="margin:0 0 10px;font-size:13px;color:#666">Owner &amp; Technician</p>
      <p style="margin:0 0 4px;font-size:13px;color:#555">📞 <a href="tel:+64212971237" style="color:#555;text-decoration:none">021 297 1237</a></p>
      <p style="margin:0 0 4px;font-size:13px;color:#555">✉️ <a href="mailto:harrison@tothepoint.co.nz" style="color:#43bccd;text-decoration:none">harrison@tothepoint.co.nz</a></p>
      <p style="margin:0 0 4px;font-size:13px;color:#555">🌐 <a href="https://tothepoint.co.nz" style="color:#43bccd;text-decoration:none">tothepoint.co.nz</a></p>
      <p style="margin:0;font-size:12px;color:#999">Auckland, New Zealand</p>
    </div>
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
