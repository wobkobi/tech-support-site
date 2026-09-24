// src/features/reviews/lib/email-enquiry.ts
// Business enquiry emails: the operator notification and the enquirer acknowledgement.

import {
  brandName,
  buildEmailSignature,
  escapeHtml,
  htmlToText,
  missingEmailEnv,
  renderNotificationEmail,
  sendNow,
} from "@/features/reviews/lib/email-core";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { getSiteUrl } from "@/shared/lib/site-url";

/** Business enquiry data used for the operator notification + enquirer ack. */
export interface BusinessEnquiryData {
  /** Company or trading name; null for a personal enquiry. */
  company: string | null;
  /** Contact person's name. */
  name: string;
  /** Contact email (reply-to target for the notification). */
  email: string;
  /** Contact phone in E.164, or null when not supplied. */
  phone: string | null;
  /** What they need help with (free text). */
  needs: string;
  /** Interest level: one-off job, retainer, or unsure. Optional. */
  interest: string | null;
  /** Urgency: this week / this month / exploring. Optional. */
  urgency: string | null;
}

/**
 * Sends the operator a notification email for a new business enquiry.
 * Failures are caught and logged - never throws.
 * @param enquiry - The enquiry details.
 * @returns Promise that resolves when the email is sent (or silently fails).
 */
export async function sendBusinessEnquiryNotification(enquiry: BusinessEnquiryData): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const from = process.env.EMAIL_FROM;

  if (!adminEmail || !from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("ADMIN_EMAIL", "EMAIL_FROM", "RESEND_API_KEY")}) - skipping business enquiry notification.`,
    );
    return;
  }

  const safeName = escapeHtml(enquiry.name);
  const safeEmail = escapeHtml(enquiry.email);
  const safeMailto = encodeURIComponent(enquiry.email);
  const needsHtml = escapeHtml(enquiry.needs).replace(/\n/g, "<br>");
  const companyBlock = enquiry.company
    ? `<p style="margin:0 0 4px;font-size:14px;color:#888">Company</p>
      <p style="margin:0 0 12px;font-size:15px;color:#0c0a3e;font-weight:600">${escapeHtml(enquiry.company)}</p>`
    : `<p style="margin:0 0 12px;font-size:14px;color:#888">Personal enquiry (no company)</p>`;
  const metaLine = [enquiry.interest, enquiry.urgency]
    .filter(Boolean)
    .map((v) => escapeHtml(v as string))
    .join(" · ");
  const phoneLine = enquiry.phone
    ? `<p style="margin:0 0 12px;font-size:14px;color:#444"><a href="tel:${escapeHtml(enquiry.phone)}" style="color:#43bccd">${escapeHtml(enquiry.phone)}</a></p>`
    : "";

  const html = renderNotificationEmail(`
    <h2 style="margin:0 0 4px;color:#0c0a3e;font-size:20px">New business enquiry</h2>
    ${metaLine ? `<p style="margin:0 0 16px;color:#555;font-size:14px">${metaLine}</p>` : ""}

    <div style="background:#f6f7f8;border-radius:8px;padding:16px;margin-bottom:20px">
      ${companyBlock}
      <p style="margin:0 0 4px;font-size:14px;color:#888">Contact</p>
      <p style="margin:0 0 4px;font-size:15px;color:#0c0a3e;font-weight:600">${safeName}</p>
      <p style="margin:0 0 12px;font-size:14px;color:#444"><a href="mailto:${safeMailto}" style="color:#43bccd">${safeEmail}</a></p>
      ${phoneLine}
      <p style="margin:0 0 4px;font-size:14px;color:#888">What they need</p>
      <p style="margin:0;font-size:14px;color:#444;line-height:1.6">${needsHtml}</p>
    </div>
`);

  try {
    await sendNow({
      from,
      // Reply goes straight back to the enquirer, not the owner inbox.
      replyTo: enquiry.email,
      to: adminEmail,
      subject: enquiry.company
        ? `Business enquiry - ${enquiry.company} (${enquiry.name})`
        : `Business enquiry - ${enquiry.name} (personal)`,
      html,
      text: htmlToText(html),
    });
  } catch (error) {
    console.error("[email] Failed to send business enquiry notification:", error);
  }
}

/**
 * Sends the enquirer a short acknowledgement of their business enquiry.
 * Failures are caught and logged - never throws.
 * @param enquiry - The enquiry details.
 * @returns Promise that resolves when the email is sent (or silently fails).
 */
export async function sendBusinessEnquiryAck(enquiry: BusinessEnquiryData): Promise<void> {
  const from = process.env.EMAIL_FROM;
  const siteUrl = getSiteUrl();

  if (!from || !process.env.RESEND_API_KEY) {
    console.warn(
      `[email] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY")}) - skipping business enquiry ack.`,
    );
    return;
  }

  const firstName = enquiry.name.split(" ")[0] ?? "";
  const safeFirstName = escapeHtml(firstName);
  // Personal enquiries thank the person directly rather than a company.
  const aboutTarget = enquiry.company ? ` for ${escapeHtml(enquiry.company)}` : "";
  const signature = await buildEmailSignature(siteUrl);
  const identity = await getIdentity();

  const html = renderNotificationEmail(`
    <h2 style="margin:0 0 16px;color:#0c0a3e;font-size:20px">Thanks for getting in touch</h2>
    <p style="margin:0 0 12px;color:#222;font-size:15px;line-height:1.6">Hi ${safeFirstName},</p>
    <p style="margin:0 0 12px;color:#222;font-size:15px;line-height:1.6">
      Thanks for your enquiry about IT support${aboutTarget}. I'll come back to you within
      one business day - usually sooner.
    </p>
    <p style="margin:0;color:#222;font-size:15px;line-height:1.6">
      If it's urgent, feel free to ring me directly.
    </p>
    ${signature}
`);

  try {
    await sendNow({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: enquiry.email,
      subject: `Thanks for your enquiry - ${brandName(identity)}`,
      html,
      text: htmlToText(html),
    });
  } catch (error) {
    console.error("[email] Failed to send business enquiry ack:", error);
  }
}
