// src/features/reviews/lib/email-core.ts
// Shared Resend sending plus the escaping, layout and signature helpers. sendNow is for owner
// mail and replies a customer is waiting on; sendOutreach is held past quiet hours.

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

// Bare http(s) URL in ALREADY-ESCAPED text. `&amp;` stays in the match; any other entity ends
// it (punctuation around the link). Case-insensitive for autocapitalised "Https://".
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
 * Turns bare http(s) URLs in already-escaped text into anchors. MUST run AFTER
 * {@link escapeHtml} so the added anchors are the only live tags.
 * @param escaped - Text that has already been through {@link escapeHtml}.
 * @returns The same text with bare URLs wrapped in anchors.
 */
export function linkifyEscaped(escaped: string): string {
  return escaped.replace(ESCAPED_URL_RE, (match) => {
    // Trim prose punctuation ("(https://x.co/a)."); brackets only come off when unbalanced.
    let url = match.replace(URL_TRAILING_PUNCT_RE, "");
    while (
      (url.endsWith(")") && countChar(url, ")") > countChar(url, "(")) ||
      (url.endsWith("]") && countChar(url, "]") > countChar(url, "["))
    ) {
      url = url.slice(0, -1).replace(URL_TRAILING_PUNCT_RE, "");
    }
    // Nothing left past the scheme - leave the text alone.
    if (!/^https?:\/\/\S/i.test(url)) return match;
    return `<a href="${url}" style="color:#43bccd">${url}</a>${match.slice(url.length)}`;
  });
}

/**
 * Customer-facing brand name: the identity business name, with " Tech" added only when it
 * doesn't already end in it, so a name saved as "To the Point" still reads in full.
 * @param identity - Live business identity (only `company` is read).
 * @param identity.company - Trading name from the identity settings.
 * @returns Brand name for customer-facing copy.
 */
export function brandName(identity: { company: string }): string {
  const name = identity.company.trim();
  return /\btech$/i.test(name) ? name : `${name} Tech`;
}

/**
 * Plain-text part derived from the rendered HTML (HTML-only mail is a spam signal).
 * Anchors become "label (url)".
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
      // Reverse escapeHtml; &amp; LAST so "&amp;lt;" doesn't decode twice into "<".
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      // Strip template indentation.
      .replace(/^[ \t]+/gm, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Renders a pricing-policy `**…**` copy string as email-safe HTML, escaping the rest.
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
 * HTML-safe placeholder values for the signature block; contactable ones are anchors.
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
 * Signature block: logo, then `identity.emailSignature` lines. Escape before placeholder
 * substitution so only placeholder anchors are live; unknown `{token}`s stay visible.
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
        // Brand colour for bold applied here; renderEmphasisedHtml is shared with body copy.
        .replace(/<strong>/g, '<strong style="color:#0c0a3e">');
      return `<p style="margin:0 0 3px;font-size:13px;color:#555">${html}</p>`;
    })
    .join("");

  return `
    <div style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e8e8e8">
      <a href="${siteUrl}" style="display:inline-block;margin-bottom:8px">
        <img src="${siteUrl}/assets/email-signature-wordmark-280x95.png" alt="${escapeHtml(brandName(identity))}" width="140" style="display:block;border:0;height:auto" />
      </a>
      ${lines}
    </div>`;
}

/**
 * Width of the email card's column; its padding sits outside it. Every email shares it, and
 * mailing pictures size to it, so a full picture fills the card.
 */
export const EMAIL_COLUMN_PX = 680;

/**
 * Wraps body HTML in the email shell ({@link EMAIL_COLUMN_PX} column) that every email shares,
 * so they all read as one set. Pinned to light scheme: the navy logo mark vanishes on an
 * auto-inverted dark card. On a phone the padding shrinks so the words and pictures get about
 * 330px of a 375px screen rather than 260px; the rules need !important to beat the inline
 * padding, which mail apps without media queries keep.
 * @param bodyHtml - Inner HTML for the card.
 * @returns A complete HTML document.
 */
export function renderNotificationEmail(bodyHtml: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><style>@media (max-width:600px){.email-shell{padding:8px!important}.email-card{padding:20px 16px!important}}</style></head>
<body class="email-shell" style="font-family:system-ui,sans-serif;background:#f6f7f8;margin:0;padding:24px">
  <div class="email-card" style="max-width:${EMAIL_COLUMN_PX}px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
${bodyHtml}
  </div>
</body>
</html>`;
}

/**
 * Wraps invoice, quote and void email HTML in the shared {@link renderNotificationEmail} card,
 * with navy as the text colour their unstyled lines inherit.
 * @param bodyHtml - Inner HTML for the card.
 * @returns A complete HTML document.
 */
export function renderDocumentEmail(bodyHtml: string): string {
  return renderNotificationEmail(`<div style="color:#0c0a3e">
${bodyHtml}
</div>`);
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
/** Per-send request options: an idempotency key makes a repeated send a no-op on Resend. */
export type MailOptions = Parameters<Resend["emails"]["send"]>[1];

/**
 * Sends immediately: operator mail and replies a customer is waiting on (confirmations,
 * manage links, enquiry acks).
 * @param payload - The Resend send payload.
 * @param options - Optional request options (idempotency key).
 * @returns Resend's send response.
 */
export function sendNow(payload: MailPayload, options?: MailOptions): Promise<MailResult> {
  return getResend().emails.send(payload, options);
}

/** One email in a batch. The batch API takes no attachments and no scheduledAt. */
export type BatchMailPayload = Parameters<Resend["batch"]["send"]>[0][number];

/**
 * Per-email outcome of {@link sendBatch}, in the same order as the payloads. `uncertain`
 * marks a whole-batch failure Resend may still have sent (no answer, or a 5xx).
 */
export type BatchMailOutcome =
  { ok: true; id: string } | { ok: false; error: string; uncertain?: boolean };

/**
 * Sends up to 100 mailing-list emails in one call with permissive validation. Resend
 * returns accepted ids in order plus rejected indexes; ids map back by skipping those.
 * @param payloads - The emails, at most 100.
 * @param idempotencyKey - Stable key for this exact batch.
 * @returns One outcome per payload, in payload order.
 */
export async function sendBatch(
  payloads: BatchMailPayload[],
  idempotencyKey: string,
): Promise<BatchMailOutcome[]> {
  const result = await getResend().batch.send(payloads, {
    batchValidation: "permissive",
    idempotencyKey,
  });
  if (result.error || !result.data) {
    const message = result.error?.message ?? "Resend returned no response";
    // A null status means the request never got an answer; only a 4xx proves nothing went.
    const status = result.error?.statusCode ?? null;
    const uncertain = status === null || status >= 500;
    return payloads.map(() => ({ ok: false, error: message, uncertain }));
  }
  const rejected = new Map(result.data.errors.map((e) => [e.index, e.message]));
  const ids = result.data.data.map((d) => d.id);
  let next = 0;
  return payloads.map((_, index) => {
    const message = rejected.get(index);
    if (message !== undefined) return { ok: false, error: message };
    const id = ids[next++];
    return id ? { ok: true, id } : { ok: false, error: "Resend returned no id" };
  });
}

/**
 * Sends outreach. Inside quiet hours Resend holds it via `scheduledAt`; the call still
 * resolves now, so the caller's "sent" stamp stops crons sending twice.
 * @param payload - The Resend send payload.
 * @param bookingId - Booking a later cancel/reschedule would invalidate; recorded so
 *   {@link cancelHeldBookingEmails} can recall it.
 * @param options - Optional request options (idempotency key).
 * @returns Resend's send response.
 */
export async function sendOutreach(
  payload: MailPayload,
  bookingId?: string,
  options?: MailOptions,
): Promise<MailResult> {
  let holdUntil: Date | null = null;
  try {
    const { comms } = await getSettings();
    holdUntil = nextSendTime({
      enabled: comms.quietHoursEnabled,
      startHour: comms.quietHoursStart,
      endHour: comms.quietHoursEnd,
    });
  } catch (err) {
    // Settings unreadable - send now; early beats missing.
    console.warn("[email] Couldn't read quiet hours, sending immediately:", err);
  }
  if (!holdUntil) return sendNow(payload, options);
  console.log(`[email] Quiet hours - holding until ${holdUntil.toISOString()}`);
  const result = await getResend().emails.send(
    {
      ...payload,
      scheduledAt: holdUntil.toISOString(),
    },
    options,
  );
  const heldId = result.data?.id;
  if (bookingId && heldId) {
    // Best-effort: failing to record only costs the ability to recall it.
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
 * Recalls customer emails Resend is holding for a booking that was cancelled or
 * rescheduled, then clears the record. Never throws.
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
    // One at a time: Resend's rate limit counts cancels.
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
 * Names the given email env vars that are unset or blank, for the "not configured" skip log.
 * @param names - Env var names the calling send path needs.
 * @returns Comma-joined list of the blank vars.
 */
export function missingEmailEnv(...names: string[]): string {
  return names.filter((n) => !process.env[n]?.trim()).join(", ");
}
