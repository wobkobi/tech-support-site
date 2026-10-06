// src/features/mailing/lib/render.ts
// Turns a mailing-list email the operator typed into the HTML and text a recipient gets.
// One renderer backs the editor preview, the test send and the real send, so all three
// always match. Pure: everything it needs from the database arrives in the context.

import type { CampaignAudience } from "@/features/mailing/lib/audience";
import {
  escapeHtml,
  htmlToText,
  linkifyEscaped,
  renderNotificationEmail,
} from "@/features/reviews/lib/email-core";

/** The parts of a campaign that get rendered. */
export interface CampaignContent {
  subject: string;
  preheader: string | null;
  body: string;
}

/** Who one copy of the email is for. */
export interface CampaignRecipient {
  /** Contact name as stored, or null when unknown. */
  name: string | null;
  /** Their latest review from the site, for {reviewText}; null or omitted when none. */
  reviewText?: string | null;
}

/** Stand-in review for the preview and test send, so {reviewText} reads naturally. */
export const SAMPLE_REVIEW_TEXT =
  "Sorted my printer and showed me how to back up my photos. Patient and easy to understand.";

/** Promo wording the {promo} placeholders expand to. */
export interface PromoWording {
  /** Banner one-liner: "$10 off until this Saturday". */
  summary: string;
  /** Just the offer: "$10 off on jobs over $100". */
  offer: string;
  /** When it ends: "this Saturday" or "Sat 16 May". */
  ends: string;
}

/** Everything the renderer needs beyond the content and the recipient. */
export interface RenderContext {
  /** Customer-facing brand name for the footer. */
  brand: string;
  /** Signature block HTML from buildEmailSignature. */
  signatureHtml: string;
  /** Wording for the promo placeholders, or null when no promo applies. */
  promo: PromoWording | null;
  /** This recipient's unsubscribe page. */
  unsubscribeUrl: string;
}

/** Placeholders the operator can type, with the help text the editor shows. */
export const PLACEHOLDERS = [
  { key: "firstName", help: 'First name, or "there" when unknown' },
  { key: "name", help: 'Full name, or "there" when unknown' },
  { key: "promo", help: "The promo in one line, with its end date" },
  { key: "promoOffer", help: 'Just the offer, like "$10 off"' },
  { key: "promoEnds", help: "When the promo ends" },
  { key: "reviewText", help: "Their own review from your site (reviewers only)" },
] as const;

type PlaceholderKey = (typeof PLACEHOLDERS)[number]["key"];

const PROMO_KEYS: ReadonlySet<string> = new Set(["promo", "promoOffer", "promoEnds"]);
const KNOWN_KEYS: ReadonlySet<string> = new Set(PLACEHOLDERS.map((p) => p.key));

/** A `{word}` placeholder anywhere in the text. */
const PLACEHOLDER_RE = /\{(\w+)\}/g;

/** A line that is only `[Text](https://...)`: rendered as a button. */
const BUTTON_LINE_RE = /^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)$/i;
/** A line that is only `![alt](https://...)`: rendered as an image. */
const IMAGE_LINE_RE = /^!\[([^\]\n]*)\]\((https:\/\/[^)\s]+)\)$/i;
/** An inline `[text](https://...)` link inside escaped paragraph text. */
const INLINE_LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gi;

/**
 * Hosts an image may come from. Only the site's own Blob store: an image the
 * operator hotlinks from elsewhere can vanish or change after the email is
 * sent, and a third-party host sees every open.
 */
const IMAGE_HOST_SUFFIX = ".public.blob.vercel-storage.com";

// Inline styles: email clients ignore stylesheets. 16px body text because most
// recipients are older and read on a phone.
const P_STYLE = "margin:0 0 14px;color:#333;font-size:16px;line-height:1.6";
const H1_STYLE = "margin:8px 0 12px;color:#0c0a3e;font-size:22px;line-height:1.3";
const H2_STYLE = "margin:8px 0 10px;color:#0c0a3e;font-size:18px;line-height:1.3";
const UL_STYLE = "margin:0 0 14px;padding-left:22px;color:#333;font-size:16px;line-height:1.6";
const LINK_STYLE = "color:#43bccd";
const BUTTON_STYLE =
  "display:inline-block;background:#43bccd;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:16px";
// 496px = the 560px card less its 32px padding each side.
const IMAGE_STYLE =
  "display:block;width:100%;max-width:496px;height:auto;border:0;border-radius:8px";

/**
 * Whether an image URL points at the site's own Blob store.
 * @param url - Image URL from an `![alt](url)` line.
 * @returns True when the host is allowed.
 */
export function isAllowedImageUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && hostname.endsWith(IMAGE_HOST_SUFFIX);
  } catch {
    return false;
  }
}

/**
 * First word of a stored name, or null when there is none.
 * @param name - Contact name.
 * @returns First name or null.
 */
function firstNameOf(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/**
 * Plain-text value for each placeholder for one recipient. Promo keys are blank
 * when no promo applies; {@link listProblems} warns about that before sending.
 * @param recipient - Who this copy is for.
 * @param promo - Promo wording, or null.
 * @returns Map from placeholder key to its value.
 */
function placeholderValues(
  recipient: CampaignRecipient,
  promo: PromoWording | null,
): Record<PlaceholderKey, string> {
  return {
    firstName: firstNameOf(recipient.name) ?? "there",
    name: recipient.name?.trim() || "there",
    promo: promo?.summary ?? "",
    promoOffer: promo?.offer ?? "",
    promoEnds: promo?.ends ?? "",
    reviewText: recipient.reviewText?.trim() ?? "",
  };
}

/**
 * Fills placeholders in plain text (the subject and preheader). An unknown
 * `{word}` is left visible, so a typo shows in the preview instead of silently
 * blanking.
 * @param text - Text containing placeholders.
 * @param values - Placeholder values.
 * @returns The filled text.
 */
function fillText(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (whole, key: string) => values[key] ?? whole);
}

/**
 * Inline formatting for one escaped line: `**bold**`, `[text](url)` links, then
 * bare URLs. Bare-URL linkifying runs only on the text between explicit links,
 * so a URL already inside an href never gets wrapped twice.
 * @param escaped - A line that has already been through escapeHtml.
 * @returns The line as HTML.
 */
function renderInline(escaped: string): string {
  const bolded = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  let out = "";
  let last = 0;
  for (const match of bolded.matchAll(INLINE_LINK_RE)) {
    const index = match.index ?? 0;
    out += linkifyEscaped(bolded.slice(last, index));
    out += `<a href="${match[2]}" style="${LINK_STYLE}">${match[1]}</a>`;
    last = index + match[0].length;
  }
  return out + linkifyEscaped(bolded.slice(last));
}

/**
 * Renders the body text to HTML. Placeholders are swapped for private-use
 * sentinel characters before parsing and filled in after, already escaped, so
 * a value can never be read as formatting: a contact named "**Bob**" gets
 * asterisks, not bold, and a name can't become a button.
 * @param body - The operator's body text.
 * @param values - Placeholder values for this recipient.
 * @returns Body HTML.
 */
export function renderBody(body: string, values: Record<string, string>): string {
  const tokens: string[] = [];
  const tokenised = body.replace(PLACEHOLDER_RE, (whole, key: string) => {
    const value = values[key];
    if (value === undefined) return whole;
    tokens.push(escapeHtml(value));
    return `\uE000${tokens.length - 1}\uE001`;
  });

  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  /** Closes the paragraph being collected. */
  function flushParagraph(): void {
    if (paragraph.length === 0) return;
    blocks.push(`<p style="${P_STYLE}">${paragraph.map(renderInline).join("<br>")}</p>`);
    paragraph = [];
  }
  /** Closes the bullet list being collected. */
  function flushList(): void {
    if (list.length === 0) return;
    blocks.push(
      `<ul style="${UL_STYLE}">${list.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`,
    );
    list = [];
  }

  for (const rawLine of tokenised.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      flushParagraph();
      list.push(escapeHtml(line.slice(2).trim()));
      continue;
    }
    flushList();

    const image = line.match(IMAGE_LINE_RE);
    if (image) {
      flushParagraph();
      // A disallowed image is dropped rather than shown; the editor lists it as a problem.
      if (isAllowedImageUrl(image[2]!)) {
        blocks.push(
          `<p style="margin:0 0 14px"><img src="${escapeHtml(image[2]!)}" alt="${escapeHtml(image[1]!)}" width="496" style="${IMAGE_STYLE}" /></p>`,
        );
      }
      continue;
    }
    const button = line.match(BUTTON_LINE_RE);
    if (button) {
      flushParagraph();
      blocks.push(
        `<p style="margin:8px 0 22px"><a href="${escapeHtml(button[2]!)}" style="${BUTTON_STYLE}">${escapeHtml(button[1]!)}</a></p>`,
      );
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      blocks.push(`<h3 style="${H2_STYLE}">${renderInline(escapeHtml(line.slice(3).trim()))}</h3>`);
      continue;
    }
    if (line.startsWith("# ")) {
      flushParagraph();
      blocks.push(`<h2 style="${H1_STYLE}">${renderInline(escapeHtml(line.slice(2).trim()))}</h2>`);
      continue;
    }
    paragraph.push(escapeHtml(line));
  }
  flushParagraph();
  flushList();

  return blocks
    .join("\n")
    .replace(/\uE000(\d+)\uE001/g, (_whole, index: string) => tokens[Number(index)] ?? "");
}

/**
 * Renders one recipient's copy of a campaign.
 * @param content - Subject, preheader and body as the operator wrote them.
 * @param recipient - Who this copy is for.
 * @param ctx - Brand, signature, promo wording and unsubscribe link.
 * @returns The filled subject, the full HTML document and its plain-text part.
 */
export function renderCampaign(
  content: CampaignContent,
  recipient: CampaignRecipient,
  ctx: RenderContext,
): { subject: string; html: string; text: string } {
  const values = placeholderValues(recipient, ctx.promo);
  const subject = fillText(content.subject, values).trim();
  const preheader = content.preheader ? fillText(content.preheader, values).trim() : "";

  // The preheader is hidden in the body; inboxes read it as the preview line.
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>`
    : "";
  const footer = `<p style="margin:24px 0 0;font-size:13px;color:#888;line-height:1.5">You're getting this because you've had help from ${escapeHtml(ctx.brand)}. If you'd rather not get emails like this, you can <a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:#888">unsubscribe</a>.</p>`;

  const html = renderNotificationEmail(`${preheaderHtml}
${renderBody(content.body, values)}
${ctx.signatureHtml}
${footer}
`);
  // The hidden preheader would otherwise lead the text part.
  const text = htmlToText(html.replace(preheaderHtml, ""));
  return { subject, html, text };
}

/**
 * Problems worth stopping for before a send: empty fields, unknown or
 * promo-less placeholders, {reviewText} on an email that isn't going to
 * reviewers (it would be blank for everyone else), and images from outside
 * the Blob store.
 * @param content - Subject, preheader and body.
 * @param hasPromo - Whether promo wording is available.
 * @param audience - Who the email goes to.
 * @returns Plain-English problems, empty when the email is good to go.
 */
export function listProblems(
  content: CampaignContent,
  hasPromo: boolean,
  audience: CampaignAudience = "everyone",
): string[] {
  const problems: string[] = [];
  if (!content.subject.trim()) problems.push("The subject is empty.");
  if (!content.body.trim()) problems.push("The email has no body text.");

  const all = `${content.subject}\n${content.preheader ?? ""}\n${content.body}`;
  const unknown = new Set<string>();
  let usesPromo = false;
  let usesReview = false;
  for (const match of all.matchAll(PLACEHOLDER_RE)) {
    const key = match[1]!;
    if (!KNOWN_KEYS.has(key)) unknown.add(key);
    else if (PROMO_KEYS.has(key)) usesPromo = true;
    else if (key === "reviewText") usesReview = true;
  }
  for (const key of unknown) {
    problems.push(`{${key}} isn't a placeholder, so it will show exactly as typed.`);
  }
  if (usesPromo && !hasPromo) {
    problems.push(
      "The email uses a promo placeholder but there's no promo running, so it would be blank.",
    );
  }
  if (usesReview && audience !== "site_reviewers") {
    problems.push(
      '{reviewText} only works when the email goes to "People who left a review on the site". Change who it goes to, or take it out.',
    );
  }

  for (const line of content.body.split(/\r?\n/)) {
    const image = line.trim().match(IMAGE_LINE_RE);
    if (image && !isAllowedImageUrl(image[2]!)) {
      problems.push(
        "An image wasn't added with the Picture button, so it's left out. Add it with the Picture button instead.",
      );
    }
  }
  return problems;
}
