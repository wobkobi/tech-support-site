// src/features/mailing/lib/resubscribe-ask.ts
// The email the Resubscribe button sends. Someone who asked to come back confirms it with
// its button, so nobody goes back on the list on the operator's word alone.

import { contactMailingState, markResubscribeAsked } from "@/features/mailing/lib/opt-out";
import { signUnsubscribeToken, unsubscribeSecret } from "@/features/mailing/lib/unsubscribe-token";
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
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";

/** What {@link askToResubscribe} reports back to the route. */
export type ResubscribeAskResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Public page where someone confirms they want mailing-list emails again. It takes the
 * unsubscribe token, which the unsubscribe route already accepts for a resubscribe.
 * @param contactId - Contact id.
 * @returns Absolute URL.
 * @throws {Error} When UNSUBSCRIBE_SECRET is unset.
 */
export function resubscribePageUrl(contactId: string): string {
  return `${getSiteUrl()}/resubscribe/${encodeURIComponent(signUnsubscribeToken(contactId))}`;
}

/**
 * Emails an unsubscribed contact a button to confirm they want mailing-list emails again,
 * and notes when it went out. They stay off the list until they press it. A bounced address
 * is refused, since the email can't reach it.
 * @param contactId - Contact id.
 * @returns ok, or the status and message to show the operator.
 */
export async function askToResubscribe(contactId: string): Promise<ResubscribeAskResult> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, deletedAt: null },
    select: { name: true, email: true },
  });
  if (!contact?.email) {
    return { ok: false, status: 404, error: "That contact has no email address." };
  }
  const { optOut } = await contactMailingState(contactId);
  if (!optOut) return { ok: false, status: 409, error: `${contact.name} is already on the list.` };
  if (optOut.source === "bounce") {
    return {
      ok: false,
      status: 409,
      error:
        "Their email bounced, so this can't reach them. Change it to an address that works and they're back on the list.",
    };
  }
  const from = process.env.EMAIL_FROM;
  if (!from || !process.env.RESEND_API_KEY || !unsubscribeSecret()) {
    console.warn(
      `[mailing] Not configured (${missingEmailEnv("EMAIL_FROM", "RESEND_API_KEY", "UNSUBSCRIBE_SECRET")}) - skipping the resubscribe email.`,
    );
    return { ok: false, status: 503, error: "Email isn't set up, so the email can't go out." };
  }

  const siteUrl = getSiteUrl();
  const firstName = escapeHtml(contact.name.trim().split(/\s+/)[0] ?? "");
  const [identity, signature] = await Promise.all([getIdentity(), buildEmailSignature(siteUrl)]);
  const html = renderNotificationEmail(`
    <h2 style="margin:0 0 16px;color:#0c0a3e;font-size:20px">Do you want my emails again?</h2>
    <p style="margin:0 0 12px;color:#222;font-size:15px;line-height:1.6">Hi ${firstName || "there"},</p>
    <p style="margin:0 0 20px;color:#222;font-size:15px;line-height:1.6">
      You asked to get my emails again. Press the button to confirm and I'll put you back on my
      list. They're the occasional email about offers, holiday hours or scam warnings, and every
      one has an unsubscribe link.
    </p>
    <a href="${resubscribePageUrl(contactId)}" style="display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600;margin:0 0 20px">Yes, add me back</a>
    <p style="margin:0;color:#444;font-size:14px;line-height:1.6">
      If you didn't ask for this, you don't need to do anything. You won't get them unless you
      press the button.
    </p>
    ${signature}
`);

  try {
    const { error } = await sendNow({
      from,
      replyTo: process.env.ADMIN_EMAIL,
      to: contact.email,
      subject: `Do you want my emails again? - ${brandName(identity)}`,
      html,
      text: htmlToText(html),
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error("[mailing] Failed to send the resubscribe email:", error);
    return { ok: false, status: 502, error: "The email didn't go out. Try again in a minute." };
  }
  await markResubscribeAsked(contactId, new Date());
  return { ok: true };
}
