// src/features/reviews/lib/email-review-ask.ts
// The review ask: the one email every review request uses - the daily job, Send now,
// and the admin's manual review-link and booking resend. Google is the main button; the
// site's own form is the fallback for people without a Google account. Every recipient
// gets the same email whatever their job was like, since Google bans asking only happy
// customers, and nothing in it is an incentive. Carries a one-click "stop asking me"
// link, because a review ask is outreach rather than a transactional email.

import { signReviewAskStopToken } from "@/features/mailing/lib/unsubscribe-token";
import {
  buildEmailSignature,
  escapeHtml,
  htmlToText,
  missingEmailEnv,
  renderNotificationEmail,
  sendOutreach,
} from "@/features/reviews/lib/email-core";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";

/** Links a review ask points at. */
export interface ReviewAskLinks {
  /** Google "write a review" link; blank makes the site form the main button. */
  googleUrl: string;
  /** The person's own /review link, opening on the form. */
  siteFormUrl: string;
  /** The "stop asking me for reviews" page. */
  stopUrl: string;
}

/** A rendered review ask. */
export interface ReviewAskEmail {
  subject: string;
  html: string;
  text: string;
}

const BUTTON_STYLE =
  "display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:16px";
const BODY_STYLE = "margin:0 0 14px;color:#444;font-size:16px;line-height:1.6";

/**
 * Renders the review ask.
 * @param firstName - Who it greets; blank greets "there".
 * @param links - Google, site-form and stop links.
 * @returns Subject, HTML and plain-text bodies.
 */
export async function buildReviewAskEmail(
  firstName: string,
  links: ReviewAskLinks,
): Promise<ReviewAskEmail> {
  const name = firstName.trim() || "there";
  const google = links.googleUrl.trim();
  const identity = await getIdentity();
  // Say who's writing up front: someone from a one-off visit months ago may not
  // place the email from the signature alone.
  const sender = `${identity.name.split(" ")[0]} here from ${identity.company} Tech`;
  const mainButton = google
    ? `<a href="${escapeHtml(google)}" style="${BUTTON_STYLE}">Leave a review on Google</a>
    <p style="margin:16px 0 0;color:#444;font-size:15px;line-height:1.6">No Google account? <a href="${escapeHtml(links.siteFormUrl)}" style="color:#1f7f8c">Leave it on my website instead</a>.</p>`
    : `<a href="${escapeHtml(links.siteFormUrl)}" style="${BUTTON_STYLE}">Leave a review</a>`;

  const html = renderNotificationEmail(`
    <h2 style="margin:0 0 14px;color:#0c0a3e;font-size:22px">Hi ${escapeHtml(name)},</h2>
    <p style="${BODY_STYLE}">${escapeHtml(sender)}. Thanks for having me out, I hope everything's still working well.</p>
    <p style="margin:0 0 24px;color:#444;font-size:16px;line-height:1.6">If you've got a minute, a quick ${google ? "Google " : ""}review would really help other people find me.</p>
    ${mainButton}
    <p style="margin:28px 0 20px;color:#444;font-size:16px;line-height:1.6">If anything still isn't right, just reply to this email.</p>
${await buildEmailSignature(getSiteUrl())}
    <p style="margin:24px 0 0;color:#666;font-size:14px;line-height:1.5">Don't want these? <a href="${escapeHtml(links.stopUrl)}" style="color:#666">Stop asking me for reviews</a>.</p>
`);

  return {
    subject: `Thanks for having me, ${name} - would you leave a quick review?`,
    html,
    text: htmlToText(html),
  };
}

/** Result of {@link sendReviewAsk}. "not_configured" means nothing was sent and nothing should be stamped. */
export type ReviewAskSendResult = "sent" | "not_configured" | "failed";

/** Who a review ask goes to. */
export interface ReviewAskRecipient {
  /** Address to send to. */
  to: string;
  /** First name to greet. */
  firstName: string;
  /** Contact id, for the signed stop link. */
  contactId: string;
  /** Review token for the site-form link (a contact's or a booking's). */
  reviewToken: string;
}

/**
 * The /review link that opens straight on the site form.
 * @param reviewToken - Contact or booking review token.
 * @returns Absolute URL.
 */
export function reviewFormUrl(reviewToken: string): string {
  return `${getSiteUrl()}/review?token=${encodeURIComponent(reviewToken)}&form=1`;
}

/**
 * Sends a review ask. Goes through the quiet-hours path, and adds List-Unsubscribe
 * headers pointing at the one-click stop route so mail apps can offer their own
 * unsubscribe button. Never throws.
 * @param recipient - Who it goes to.
 * @param idempotencyKey - Stable key for this ask, so a retried send after an
 *   interrupted run is a no-op on Resend's side instead of a second email.
 * @returns "sent", "not_configured" (email env unset - nothing sent), or "failed".
 */
export async function sendReviewAsk(
  recipient: ReviewAskRecipient,
  idempotencyKey?: string,
): Promise<ReviewAskSendResult> {
  const from = process.env.EMAIL_FROM;
  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping review ask.`,
    );
    return "not_configured";
  }

  try {
    const siteUrl = getSiteUrl();
    // Throws when UNSUBSCRIBE_SECRET is unset: no working stop link, no send.
    const stopToken = signReviewAskStopToken(recipient.contactId);
    const { reviews } = await getSettings();
    const email = await buildReviewAskEmail(recipient.firstName, {
      googleUrl: reviews.googleReviewUrl,
      siteFormUrl: reviewFormUrl(recipient.reviewToken),
      stopUrl: `${siteUrl}/review-asks/stop/${stopToken}`,
    });
    const result = await sendOutreach(
      {
        from,
        replyTo: process.env.ADMIN_EMAIL,
        to: recipient.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: {
          "List-Unsubscribe": `<${siteUrl}/api/review-asks/stop/${stopToken}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      },
      undefined,
      idempotencyKey ? { idempotencyKey } : undefined,
    );
    // A rejection comes back as { error }, not a throw.
    if (result.error) {
      console.error(
        `[email] Resend rejected review ask to contact ${recipient.contactId}:`,
        result.error,
      );
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error(`[email] Failed to send review ask to contact ${recipient.contactId}:`, error);
    return "failed";
  }
}
