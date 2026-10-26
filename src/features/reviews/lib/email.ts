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
import { formatNZPhone } from "@/shared/lib/normalise-phone";
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
  /** "approved" when it went live straight away (verified, with auto-approve on). */
  status: "approved" | "pending";
  /** True when the customer edited a review they had already left. */
  edited?: boolean;
  /** Phone left under "Stay in touch", if any. */
  contactPhone?: string | null;
  /** Email left under "Stay in touch", if any. */
  contactEmail?: string | null;
}

/**
 * Sends the site owner a notification email when a review is submitted or edited. The
 * badge and button follow the review's real status, and any "Stay in touch" details the
 * customer left are shown so they reach the owner even when no contact could take them.
 * Failures are caught and logged - never throws.
 * @param review - The submitted or edited review.
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

  const live = review.status === "approved";
  const badge = live
    ? "✅ Verified and published automatically"
    : review.verified
      ? "⏳ Verified, waiting for your approval"
      : "⏳ Waiting for your approval";
  const heading = review.edited ? "Review edited" : "New review submitted";
  const editNote = review.edited
    ? `<p style="margin:0 0 20px;color:#555;font-size:14px">An edit takes the review off your site until you approve it again.</p>`
    : "";
  const adminUrl = `${siteUrl}/admin/reviews`;
  const safeDisplayName = escapeHtml(displayName);
  const safeReviewText = escapeHtml(review.text).replace(/\n/g, "<br>");
  const details = [
    review.contactPhone ? `Phone: ${escapeHtml(formatNZPhone(review.contactPhone))}` : null,
    review.contactEmail ? `Email: ${escapeHtml(review.contactEmail)}` : null,
  ].filter(Boolean);
  const detailsBlock = details.length
    ? `<p style="margin:0 0 20px;color:#222;font-size:14px"><strong>Left their details:</strong> ${details.join(" &middot; ")}</p>`
    : "";

  const html = renderNotificationEmail(`
    <h2 style="margin:0 0 8px;color:#0c0a3e;font-size:20px">${heading}</h2>
    <p style="margin:0 0 20px;color:#555;font-size:14px">${badge}</p>
    ${editNote}

    <div style="background:#f6f7f8;border-radius:8px;padding:16px;margin-bottom:20px">
      <p style="margin:0 0 8px;font-size:14px;color:#888"><strong style="color:#0c0a3e">${safeDisplayName}</strong></p>
      <p style="margin:0;color:#222;line-height:1.6;font-size:15px">${safeReviewText}</p>
    </div>
    ${detailsBlock}

    ${
      !live
        ? `<a href="${adminUrl}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">✅ Review &amp; Approve</a>`
        : `<p style="margin-top:12px;margin-bottom:0;color:#555;font-size:14px">It's already showing on your site.</p>`
    }
`);

  try {
    await sendNow({
      from,
      replyTo: adminEmail,
      to: adminEmail,
      subject: `${review.edited ? "Review edited" : "New review"} - ${displayName} (${live ? "published" : "waiting for approval"})`,
      html,
      text: htmlToText(html),
    });
  } catch (error) {
    console.error("[email] Failed to send owner review notification:", error);
  }
}
