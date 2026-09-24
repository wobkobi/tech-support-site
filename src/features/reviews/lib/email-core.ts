// src/features/reviews/lib/email-core.ts
// Shared Resend utility for sending transactional emails, plus the escaping, layout
// and signature helpers every email family renders with. Every send goes out through
// one of two doors: sendNow for owner mail and the replies a customer is waiting on,
// sendOutreach for everything the site initiates, which Resend holds until the
// quiet-hours window closes.

import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import { nextSendTime } from "@/shared/lib/quiet-hours";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { Resend } from "resend";

/**
 * Escapes HTML so user-supplied values can be interpolated into email bodies.
 * @param value - The string to escape.
 * @returns The escaped string.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Bare http(s) URL inside ALREADY-ESCAPED text. `&amp;` stays in the match (a real query
// separator the operator typed); any other entity ends it, since &quot; / &#39; / &lt; /
// &gt; came from punctuation AROUND the link. http(s) only, so javascript: and data: can
// never become anchors. Case-insensitive: a phone keyboard autocapitalises "Https://".
const ESCAPED_URL_RE = /https?:\/\/(?:&amp;|[^\s&])+/gi;

/** Sentence punctuation that belongs to the prose, not to a trailing URL. */
const URL_TRAILING_PUNCT_RE = /[.,;:!?]+$/;

/**
 * Occurrences of a single character, for the bracket-balance trim below.
 * @param haystack - String to scan.
 * @param char - Character to count.
 * @returns Number of occurrences.
 */
function countChar(haystack: string, char: string): number {
  return haystack.split(char).length - 1;
}

/**
 * Turns bare http(s) URLs in already-escaped text into anchors, so a link the
 * operator types into a message box is clickable in the email rather than inert
 * text.
 *
 * MUST run AFTER {@link escapeHtml}, never before: the input has no live markup
 * left, so the anchors this adds are the only tags in the result and a pasted
 * `<a href>` still renders as visible text. Escaped `&amp;` passes through into
 * the href unchanged, which is what an HTML attribute expects.
 * @param escaped - Text that has already been through {@link escapeHtml}.
 * @returns The same text with bare URLs wrapped in anchors.
 */
export function linkifyEscaped(escaped: string): string {
  return escaped.replace(ESCAPED_URL_RE, (match) => {
    // Trim what reads as prose: "see https://x.co/a." and "(https://x.co/a)"
    // should link the URL alone. Brackets only come off when unbalanced, so a
    // URL that legitimately contains "(...)" survives intact.
    let url = match.replace(URL_TRAILING_PUNCT_RE, "");
    while (
      (url.endsWith(")") && countChar(url, ")") > countChar(url, "(")) ||
      (url.endsWith("]") && countChar(url, "]") > countChar(url, "["))
    ) {
      url = url.slice(0, -1).replace(URL_TRAILING_PUNCT_RE, "");
    }
    // Nothing left past the scheme - leave the text alone rather than emit an
    // anchor pointing at "https://".
    if (!/^https?:\/\/\S/i.test(url)) return match;
    return `<a href="${url}" style="color:#43bccd">${url}</a>${match.slice(url.length)}`;
  });
}

/**
 * Customer-facing brand name: the identity company plus the " Tech" suffix the
 * signature, subjects, and bodies all share. Centralised so renaming the
 * business in Settings moves every email at once, and so the suffix lives in
 * one place rather than being spelled out at each use.
 * @param identity - Live business identity (only `company` is read).
 * @param identity.company - Trading name from the identity settings.
 * @returns Brand name for customer-facing copy.
 */
export function brandName(identity: { company: string }): string {
  return `${identity.company} Tech`;
}

/**
 * Plain-text fallback derived from the rendered HTML, so every email ships a
 * text/plain part alongside the HTML one: clients that refuse HTML still show
 * something readable, and an HTML-only message is a mild spam-filter signal.
 * Anchors keep their destination as "label (url)", since a text reader cannot
 * follow a link it cannot see.
 * @param html - Rendered email HTML.
 * @returns Plain-text equivalent.
 */
export function htmlToText(html: string): string {
  return (
    html
      .replace(/<head[\s\S]*?<\/head>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href, label) => {
        const text = String(label)
          .replace(/<[^>]+>/g, "")
          .trim();
        return text && text !== href ? `${text} (${href})` : String(href);
      })
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|h1|h2|h3|tr|li)>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      // Reverse escapeHtml. &amp; comes LAST so an escaped "&amp;lt;" does not
      // decode twice into a live "<".
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      // The HTML templates are indented for readability; that indentation would
      // otherwise show up as ragged leading whitespace on every text line.
      .replace(/^[ \t]+/gm, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Renders a pricing-policy `**…**` copy string as email-safe HTML. Non-marker
 * segments are HTML-escaped as cheap insurance against future user input.
 * @param text - Copy string containing zero or more `**…**` segments.
 * @returns HTML fragment ready to drop into an email body.
 */
export function renderEmphasisedHtml(text: string): string {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part) => {
      const m = part.match(/^\*\*([^*]+)\*\*$/);
      return m ? `<strong>${escapeHtml(m[1] ?? "")}</strong>` : escapeHtml(part);
    })
    .join("");
}

/**
 * Placeholder values the signature block can interpolate, each already safe to
 * drop into HTML. The contactable ones come back as anchors so a phone number or
 * address stays tappable wherever the operator chooses to place it.
 * @param identity - Live identity settings.
 * @param siteUrl - Absolute site URL.
 * @returns Map from placeholder name to ready-to-insert HTML.
 */
function signaturePlaceholders(
  identity: Awaited<ReturnType<typeof getIdentity>>,
  siteUrl: string,
): Record<string, string> {
  return {
    name: escapeHtml(identity.name),
    company: escapeHtml(brandName(identity)),
    location: escapeHtml(identity.location),
    phone: `<a href="${identity.phoneTel}" style="color:#555;text-decoration:none">${escapeHtml(identity.phone)}</a>`,
    email: `<a href="mailto:${identity.email}" style="color:#43bccd;text-decoration:none">${escapeHtml(identity.email)}</a>`,
    website: `<a href="${siteUrl}" style="color:#43bccd;text-decoration:none">${escapeHtml(siteUrl.replace(/^https?:\/\//, ""))}</a>`,
  };
}

/**
 * Signature block: the logo, then the operator's own lines from
 * `identity.emailSignature`. Escaping runs before placeholder substitution, so
 * the anchors those placeholders expand to survive while anything the operator
 * types stays inert text. An unknown `{token}` is left visible rather than
 * dropped, so a typo shows up in the email instead of silently blanking a line.
 * @param siteUrl - Absolute site URL used for the logo and website links.
 * @returns HTML fragment appended to the end of an email body.
 */
export async function buildEmailSignature(siteUrl: string): Promise<string> {
  const identity = await getIdentity();
  const placeholders = signaturePlaceholders(identity, siteUrl);

  const lines = identity.emailSignature
    .split("\n")
    .map((line) => {
      if (!line.trim()) return `<div style="height:8px"></div>`;
      const html = renderEmphasisedHtml(line)
        .replace(/\{(\w+)\}/g, (whole, key: string) => placeholders[key] ?? whole)
        // renderEmphasisedHtml is shared with body copy, so the brand colour for
        // bold is applied here rather than baked into that helper.
        .replace(/<strong>/g, '<strong style="color:#0c0a3e">');
      return `<p style="margin:0 0 3px;font-size:13px;color:#555">${html}</p>`;
    })
    .join("");

  return `
    <div style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e8e8e8">
      <a href="${siteUrl}" style="display:inline-block;margin-bottom:8px">
        <img src="${siteUrl}/assets/email-signature-280x95.png" alt="${escapeHtml(brandName(identity))}" width="140" style="display:block;border:0;height:auto" />
      </a>
      ${lines}
    </div>`;
}

/**
 * Wraps body HTML in the notification email shell (560px card, soft shadow,
 * system font stack) used by the owner/customer notices. Pins the document to a
 * light colour scheme: the signature logo is a transparent PNG whose chip mark
 * is deep navy, so a client that auto-inverts the card to dark would leave the
 * mark all but invisible against it.
 * @param bodyHtml - Inner HTML for the card.
 * @returns A complete HTML document.
 */
export function renderNotificationEmail(bodyHtml: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
${bodyHtml}
  </div>
</body>
</html>`;
}

/**
 * Wraps body HTML in the document email shell (600px card, no shadow, Apple /
 * Segoe font stack) used by the invoice, quote and void emails.
 * Kept separate from {@link renderNotificationEmail} rather than parameterised:
 * the two differ in width, shadow, font stack and padding, so a single shell
 * with flags would misrepresent them as one design.
 * @param bodyHtml - Inner HTML for the card.
 * @returns A complete HTML document.
 */
export function renderDocumentEmail(bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="color-scheme" content="light" /><meta name="supported-color-schemes" content="light" /></head>
<body style="margin:0;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0c0a3e;background:#f6f7f8">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
${bodyHtml}
  </div>
</body>
</html>`;
}

// Lazy singleton so module import never throws when RESEND_API_KEY is unset.
let _resend: Resend | null = null;
/**
 * Returns the shared Resend client, initialising it on first call.
 * @returns Resend client instance.
 */
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

/** A Resend send payload, taken from the client so it can never drift from it. */
export type MailPayload = Parameters<Resend["emails"]["send"]>[0];
/** What Resend answers a send with - `{ data, error }`, never a throw. */
type MailResult = Awaited<ReturnType<Resend["emails"]["send"]>>;

/**
 * Sends immediately. For mail to the operator, and for the replies a customer is
 * sitting waiting on - their own booking confirmation, manage-booking links, an
 * enquiry acknowledgement. Holding those would read as the site being broken.
 * @param payload - The Resend send payload.
 * @returns Resend's send response.
 */
export function sendNow(payload: MailPayload): Promise<MailResult> {
  return getResend().emails.send(payload);
}

/**
 * Sends outreach - mail the customer did not just ask for. Inside the quiet-hours
 * window the send is handed to Resend with a `scheduledAt` for the moment the
 * window closes, so a job finished at 11pm doesn't buzz a phone at 11pm.
 *
 * Resend does the waiting, so there is no queue here to drain or retry, and the
 * call resolves now either way: the caller's "sent" stamp still lands at click
 * time, which is what stops the crons sending a second copy.
 * @param payload - The Resend send payload.
 * @param bookingId - The booking the email is about, when a later cancel or
 *   reschedule would make it wrong. A held send is recorded on the booking so
 *   {@link cancelHeldBookingEmails} can recall it.
 * @returns Resend's send response.
 */
export async function sendOutreach(payload: MailPayload, bookingId?: string): Promise<MailResult> {
  let holdUntil: Date | null = null;
  try {
    const { comms } = await getSettings();
    holdUntil = nextSendTime({
      enabled: comms.quietHoursEnabled,
      startHour: comms.quietHoursStart,
      endHour: comms.quietHoursEnd,
    });
  } catch (err) {
    // Settings unreadable (no request context, DB blip). Send now rather than
    // lose the mail - being early is a smaller fault than being missing.
    console.warn("[email] Couldn't read quiet hours, sending immediately:", err);
  }
  if (!holdUntil) return sendNow(payload);
  console.log(`[email] Quiet hours - holding until ${holdUntil.toISOString()}`);
  const result = await getResend().emails.send({
    ...payload,
    scheduledAt: holdUntil.toISOString(),
  });
  const heldId = result.data?.id;
  if (bookingId && heldId) {
    // Best-effort: the email is already queued, and failing to record it only
    // costs the ability to recall it.
    await prisma.booking
      .update({
        where: { id: bookingId },
        data: { heldEmails: { push: { id: heldId, sendAt: holdUntil } } },
      })
      .catch((err: unknown) =>
        console.warn(`[email] Couldn't record held email ${heldId} on ${bookingId}:`, err),
      );
  }
  return result;
}

/**
 * Recalls the customer emails Resend is still holding for a booking's quiet
 * window. For a cancel or reschedule that makes them wrong: otherwise the
 * customer wakes to a reminder for a visit that was called off, or a "moved"
 * notice showing a time that has since changed again. Clears the record
 * either way. Never throws.
 * @param bookingId - The booking whose held emails to recall.
 */
export async function cancelHeldBookingEmails(bookingId: string): Promise<void> {
  try {
    const row = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { heldEmails: true },
    });
    if (!row || row.heldEmails.length === 0) return;
    const now = Date.now();
    // One at a time: a booking holds one or two at most, and Resend's rate
    // limit counts cancels.
    for (const held of row.heldEmails) {
      if (held.sendAt.getTime() <= now) continue; // already sent
      const { error } = await getResend().emails.cancel(held.id);
      if (error) console.warn(`[email] Couldn't recall held email ${held.id}:`, error.message);
    }
    await prisma.booking.update({ where: { id: bookingId }, data: { heldEmails: { set: [] } } });
  } catch (err) {
    console.error(`[email] Failed to recall held emails for booking ${bookingId}:`, err);
  }
}

/**
 * Names the given email env vars that are unset or blank, so a "not configured"
 * skip log says exactly which var to fix. The email layer deliberately skips
 * (never throws) when unconfigured; this only makes the cause visible.
 * @param names - Env var names the calling send path needs.
 * @returns Comma-joined list of the blank vars.
 */
export function missingEmailEnv(...names: string[]): string {
  return names.filter((n) => !process.env[n]?.trim()).join(", ");
}
