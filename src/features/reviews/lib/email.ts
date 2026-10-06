// src/features/reviews/lib/email.ts
// The owner's new-review notification. The customer-facing review ask lives in
// email-review-ask.ts.

import {
  escapeHtml,
  htmlToText,
  missingEmailEnv,
  renderNotificationEmail,
  sendNow,
} from "@/features/reviews/lib/email-core";
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
