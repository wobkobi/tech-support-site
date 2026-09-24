// src/features/reviews/lib/email.ts
// Review emails: the owner's new-review notification and the customer review requests.

import {
  brandName,
  buildEmailSignature,
  escapeHtml,
  htmlToText,
  missingEmailEnv,
  renderNotificationEmail,
  sendNow,
  sendOutreach,
} from "@/features/reviews/lib/email-core";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { getSiteUrl } from "@/shared/lib/site-url";

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
  const siteUrl = getSiteUrl();

  if (!adminEmail || !from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("ADMIN_EMAIL", "EMAIL_FROM", "RESEND_API_KEY")}) - skipping owner notification.`,
    );
    return;
  }

  const displayName = review.isAnonymous
    ? "Anonymous"
    : [review.firstName, review.lastName].filter(Boolean).join(" ") || "Unknown";

  const badge = review.verified ? "✅ Verified (auto-approved)" : "⏳ Pending approval";
  const adminUrl = `${siteUrl}/admin/reviews`;
  const safeDisplayName = escapeHtml(displayName);
  const safeReviewText = escapeHtml(review.text).replace(/\n/g, "<br>");

  const html = renderNotificationEmail(`
    <h2 style="margin:0 0 8px;color:#0c0a3e;font-size:20px">New review submitted</h2>
    <p style="margin:0 0 20px;color:#555;font-size:14px">${badge}</p>

    <div style="background:#f6f7f8;border-radius:8px;padding:16px;margin-bottom:20px">
      <p style="margin:0 0 8px;font-size:14px;color:#888"><strong style="color:#0c0a3e">${safeDisplayName}</strong></p>
      <p style="margin:0;color:#222;line-height:1.6;font-size:15px">${safeReviewText}</p>
    </div>

    ${
      !review.verified
        ? `<a href="${adminUrl}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">✅ Review &amp; Approve</a>`
        : `<p style="margin-top:12px;margin-bottom:0;color:#555;font-size:14px">This review has been verified.</p>`
    }
`);

  try {
    await sendNow({
      from,
      replyTo: adminEmail,
      to: adminEmail,
      subject: `New review - ${displayName} (${review.verified ? "verified" : "pending"})`,
      html,
      text: htmlToText(html),
    });
  } catch (error) {
    console.error("[email] Failed to send owner review notification:", error);
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
 * Failures are caught and logged - never throws.
 * @param booking - Booking details for the customer.
 * @returns True when the email was sent (or intentionally skipped because Resend
 *   is not configured); false when the send failed and should be retried.
 */
export async function sendCustomerReviewRequest(booking: ReviewRequestData): Promise<boolean> {
  const from = process.env.EMAIL_FROM;
  const siteUrl = getSiteUrl();

  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping customer review request.`,
    );
    return true;
  }

  const identity = await getIdentity();
  const reviewUrl = `${siteUrl}/review?token=${encodeURIComponent(booking.reviewToken)}`;
  const firstName = booking.name.split(" ")[0] ?? "";
  const safeFirstName = escapeHtml(firstName);

  const html = renderNotificationEmail(`
    <h2 style="margin:0 0 12px;color:#0c0a3e;font-size:20px">Hi ${safeFirstName}, how did everything go?</h2>
    <p style="margin:0 0 12px;color:#444;line-height:1.6">It was great meeting you - I hope I managed to get everything sorted and left you feeling a bit less frustrated with technology!</p>
    <p style="margin:0 0 12px;color:#444;line-height:1.6">If you have a spare moment, I'd love to hear how it went. A quick review makes a real difference for a small local business like mine, and helps other people find reliable tech support when they need it.</p>
    <p style="margin:0 0 24px;color:#444;line-height:1.6">It only takes a minute, and honest feedback is always welcome.</p>
    <a href="${reviewUrl}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px">Leave a review</a>

    <p style="margin:28px 0 20px;color:#444;font-size:14px;line-height:1.6">Thanks again for choosing ${escapeHtml(brandName(identity))}. If you ever need a hand with anything else, don't hesitate to get in touch.</p>
${await buildEmailSignature(siteUrl)}
`);

  try {
    const result = await sendOutreach({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: booking.email,
      subject: `Thanks for having me, ${firstName} - how did everything go?`,
      html,
      text: htmlToText(html),
    });
    // A rejection comes back as { error }, not a throw; false keeps it retryable.
    if (result.error) {
      console.error(`[email] Resend rejected review request for ${booking.id}:`, result.error);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[email] Failed to send review request for booking ${booking.id}:`, error);
    return false;
  }
}

/**
 * Builds the HTML body for a past-client review request email.
 * @param firstName - Customer's first name.
 * @param reviewUrl - The personalised review link URL.
 * @returns HTML string ready to send.
 */
export async function buildPastClientReviewEmailHtml(
  firstName: string,
  reviewUrl: string,
): Promise<string> {
  const siteUrl = getSiteUrl();
  const identity = await getIdentity();
  const safeFirstName = escapeHtml(firstName);
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h2 style="margin:0 0 12px;color:#0c0a3e;font-size:20px">Hi ${safeFirstName},</h2>
    <p style="margin:0 0 12px;color:#444;line-height:1.6">It's ${escapeHtml(identity.name.split(" ")[0] ?? "")} from ${escapeHtml(brandName(identity))} - thanks again for letting me help you out!</p>
    <p style="margin:0 0 12px;color:#444;line-height:1.6">If you have a spare moment, a quick review would mean a lot - it really helps other people find reliable local tech support.</p>
    <p style="margin:0 0 24px;color:#444;line-height:1.6">No pressure at all, but if you're happy to, I'd really appreciate it.</p>
    <a href="${reviewUrl}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px">Leave a review</a>

    <p style="margin:28px 0 20px;color:#444;font-size:14px;line-height:1.6">If you ever need a hand with anything else, don't hesitate to get in touch.</p>
${await buildEmailSignature(siteUrl)}
  </div>
</body>
</html>`;
}

/**
 * Sends a review request email to a past client (admin-triggered).
 * Tone is tailored for clients who were seen days/weeks ago, mentioning
 * the site update and asking for a review. Failures are caught and logged.
 * @param booking - Past client details.
 * @returns True when the email was sent (or intentionally skipped because Resend
 *   is not configured); false when the send failed.
 */
export async function sendPastClientReviewRequest(booking: ReviewRequestData): Promise<boolean> {
  const from = process.env.EMAIL_FROM;
  const siteUrl = getSiteUrl();

  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping past client review request.`,
    );
    return true;
  }

  const reviewUrl = `${siteUrl}/review?token=${encodeURIComponent(booking.reviewToken)}`;
  const firstName = booking.name.split(" ")[0] ?? "";
  const identity = await getIdentity();
  const html = await buildPastClientReviewEmailHtml(firstName, reviewUrl);

  try {
    const result = await sendOutreach({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: booking.email,
      subject: `Hi ${firstName}, it's ${identity.name.split(" ")[0]} from ${brandName(identity)}`,
      html,
      text: htmlToText(html),
    });
    // A rejection comes back as { error }, not a throw.
    if (result.error) {
      console.error(
        `[email] Resend rejected past client review request for ${booking.id}:`,
        result.error,
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      `[email] Failed to send past client review request for request ${booking.id}:`,
      error,
    );
    return false;
  }
}
