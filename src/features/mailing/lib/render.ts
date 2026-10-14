// src/features/mailing/lib/render.ts
// Turns a mailing-list email the operator typed into the HTML and text a recipient gets.
// One renderer backs the editor preview, the test send and the real send, so all three
// always match. Pure: everything it needs from the database arrives in the context.

import type { CampaignAudience } from "@/features/mailing/lib/audience";
import {
  BUTTON_LINE_RE,
  DIRECTIVE_RE,
  DIVIDER_RE,
  IMAGE_LINE_RE,
  INLINE_LINK_RE,
  isDirective,
  isListLine,
  LINKED_IMAGE_LINE_RE,
  PICTURE_PLACEHOLDER_RE,
  QUOTE_LINE_RE,
  QUOTE_NAME_RE,
  QUOTE_STARS_RE,
} from "@/features/mailing/lib/body-syntax";
import {
  escapeHtml,
  htmlToText,
  linkifyEscaped,
  renderNotificationEmail,
} from "@/features/reviews/lib/email-core";
import {
  FACEBOOK_PAGE_URL,
  GOOGLE_BUSINESS_PROFILE_URL,
  INSTAGRAM_URL,
} from "@/shared/lib/business-profiles";

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
  /** Weekday or time-of-day limit, like "weekdays" or "Tuesdays 9am to 5pm"; null when none. */
  restriction?: string | null;
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

/**
 * A whole line shaped like a button or picture, `[text](...)` or `![alt](...)`,
 * optionally wrapped in a link. Used to catch one whose link is missing or
 * isn't a web address, which would otherwise go out as raw brackets.
 */
const LINK_SHAPED_LINE_RE = /^\[?!?\[[^\]\n]*\]\([^)\n]*\)(?:\]\([^)\n]*\))?$/;

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
// Moonstone-700: white on it is 5.8:1, where the brand moonstone is 2.3:1 and
// fails for 16px text.
const BUTTON_BG = "#206f79";
const BUTTON_STYLE = `display:inline-block;background:${BUTTON_BG};color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:16px`;
// Outlook ignores padding and radius on an <a>, so the button also sits in a
// one-cell table whose cell carries the colour: there it still shows as a
// solid, tappable block rather than a bare link.
const BUTTON_TABLE = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px"><tr><td style="background:${BUTTON_BG};border-radius:8px">`;
// 496px = the 560px card less its 32px padding each side; a small picture is half that.
const IMAGE_STYLE =
  "display:block;width:100%;max-width:496px;height:auto;border:0;border-radius:8px";
const SMALL_IMAGE_STYLE =
  "display:block;width:100%;max-width:248px;height:auto;border:0;border-radius:8px;margin:0 auto";
// Boxed blocks use a full-width one-cell table: the reliable way to get a
// background, border and padding in every email client.
const BOX_TABLE =
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px">';
const PROMO_CELL_STYLE =
  "background:#ecf8fa;border:1px solid #43bccd;border-radius:10px;padding:18px 20px;text-align:center";
const PROMO_OFFER_STYLE =
  "margin:0 0 4px;color:#0c0a3e;font-size:22px;font-weight:700;line-height:1.3";
const PROMO_ENDS_STYLE = "margin:0;color:#333;font-size:16px;line-height:1.5";
const QUOTE_CELL_STYLE = "border-left:4px solid #43bccd;padding:4px 0 4px 16px";
// Mustard-600: the brand mustard is too pale to see on white.
const STARS_STYLE = "margin:0 0 6px;color:#cb9801;font-size:20px;letter-spacing:2px";
const QUOTE_TEXT_STYLE =
  "margin:0 0 8px;color:#333;font-size:17px;line-height:1.6;font-style:italic";
const QUOTE_NAME_STYLE = "margin:0;color:#555;font-size:15px;line-height:1.5";
const DIVIDER_HTML = '<hr style="border:0;border-top:1px solid #dde3e8;margin:22px 0" />';
const SPACER_HTML = '<div style="height:20px;line-height:20px;font-size:1px">&nbsp;</div>';
// Text links, not icons: many email apps block images by default, and words
// read better for older recipients than small logos.
const SOCIAL_HTML = `<p style="${P_STYLE};text-align:center">Find us on <a href="${GOOGLE_BUSINESS_PROFILE_URL}" style="${LINK_STYLE}">Google</a> · <a href="${FACEBOOK_PAGE_URL}" style="${LINK_STYLE}">Facebook</a> · <a href="${INSTAGRAM_URL}" style="${LINK_STYLE}">Instagram</a></p>`;

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
 * HTML for one picture, or null when its host isn't allowed (the editor lists
 * that as a problem). A small picture is half width and centred.
 * @param alt - Alt text, already escaped.
 * @param url - Image URL.
 * @param small - Whether the picture is the small size.
 * @param link - Where tapping the picture goes, or null.
 * @returns The picture's HTML, or null.
 */
function pictureHtml(alt: string, url: string, small: boolean, link: string | null): string | null {
  if (!isAllowedImageUrl(url)) return null;
  const img = small
    ? `<img src="${escapeHtml(url)}" alt="${alt}" width="248" style="${SMALL_IMAGE_STYLE}" />`
    : `<img src="${escapeHtml(url)}" alt="${alt}" width="496" style="${IMAGE_STYLE}" />`;
  const inner = link ? `<a href="${escapeHtml(link)}" style="display:block">${img}</a>` : img;
  return `<p style="margin:0 0 14px${small ? ";text-align:center" : ""}">${inner}</p>`;
}

/**
 * HTML for a `::word` line: the promo card, a spacer or the social links row.
 * The promo card is empty when no promo applies; {@link listProblems} warns
 * about that before sending. An unknown word renders nothing.
 * @param word - The word after `::`.
 * @param promo - Promo wording, or null.
 * @returns The block's HTML, or an empty string.
 */
function directiveHtml(word: string, promo: PromoWording | null): string {
  if (!isDirective(word)) return "";
  if (word === "space") return SPACER_HTML;
  if (word === "social") return SOCIAL_HTML;
  if (!promo) return "";
  const limit = promo.restriction ? `, ${escapeHtml(promo.restriction)} only` : "";
  return `${BOX_TABLE}<tr><td style="${PROMO_CELL_STYLE}"><p style="${PROMO_OFFER_STYLE}">${escapeHtml(promo.offer)}</p><p style="${PROMO_ENDS_STYLE}">Ends ${escapeHtml(promo.ends)}${limit}</p></td></tr></table>`;
}

/**
 * Renders the body text to HTML. Placeholders are swapped for private-use
 * sentinel characters before parsing and filled in after, already escaped, so
 * a value can never be read as formatting: a contact named "**Bob**" gets
 * asterisks, not bold, and a name can't become a button.
 * @param body - The operator's body text.
 * @param values - Placeholder values for this recipient.
 * @param promo - Promo wording for the promo card, or null when none applies.
 * @returns Body HTML.
 */
export function renderBody(
  body: string,
  values: Record<string, string>,
  promo: PromoWording | null = null,
): string {
  const tokens: string[] = [];
  const tokenised = body.replace(PLACEHOLDER_RE, (whole, key: string) => {
    const value = values[key];
    if (value === undefined) return whole;
    tokens.push(escapeHtml(value));
    return `\uE000${tokens.length - 1}\uE001`;
  });
  /**
   * Swaps the sentinels back for their escaped values.
   * @param text - Text that may hold sentinels.
   * @returns The filled text.
   */
  function fill(text: string): string {
    return text.replace(
      /\uE000(\d+)\uE001/g,
      (_whole, index: string) => tokens[Number(index)] ?? "",
    );
  }

  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let quote: string[] = [];

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
  /**
   * Closes the review quote being collected. A first line of only stars is the
   * rating and a last `- Name` line is who said it. A quote whose text comes
   * out blank for this recipient (an empty {reviewText}) is left out entirely
   * rather than sent as an empty box.
   */
  function flushQuote(): void {
    if (quote.length === 0) return;
    const lines = quote.filter(Boolean);
    quote = [];
    const stars = lines[0]?.match(QUOTE_STARS_RE)?.[1] ?? "";
    if (stars) lines.shift();
    const name = lines.length > 1 ? (lines.at(-1)?.match(QUOTE_NAME_RE)?.[1] ?? "") : "";
    if (name) lines.pop();
    const text = lines.map((l) => renderInline(escapeHtml(l))).join("<br>");
    if (!fill(text).trim()) return;
    const starsHtml = stars
      ? `<p style="${STARS_STYLE}" role="img" aria-label="${stars.length} out of 5 stars">${stars}</p>`
      : "";
    const nameHtml = name
      ? `<p style="${QUOTE_NAME_STYLE}">- ${renderInline(escapeHtml(name))}</p>`
      : "";
    blocks.push(
      `${BOX_TABLE}<tr><td style="${QUOTE_CELL_STYLE}">${starsHtml}<p style="${QUOTE_TEXT_STYLE}">${text}</p>${nameHtml}</td></tr></table>`,
    );
  }

  for (const rawLine of tokenised.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }
    const quoted = line.match(QUOTE_LINE_RE);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]!.trim());
      continue;
    }
    flushQuote();
    if (isListLine(line)) {
      flushParagraph();
      list.push(escapeHtml(line.slice(2).trim()));
      continue;
    }
    flushList();

    if (DIVIDER_RE.test(line)) {
      flushParagraph();
      blocks.push(DIVIDER_HTML);
      continue;
    }
    const directive = line.match(DIRECTIVE_RE);
    if (directive) {
      flushParagraph();
      const html = directiveHtml(directive[1]!, promo);
      if (html) blocks.push(html);
      continue;
    }
    if (PICTURE_PLACEHOLDER_RE.test(line)) {
      flushParagraph();
      continue;
    }
    const linked = line.match(LINKED_IMAGE_LINE_RE);
    const image = linked ?? line.match(IMAGE_LINE_RE);
    if (image) {
      flushParagraph();
      const html = pictureHtml(
        escapeHtml(image[1]!),
        image[2]!,
        Boolean(image[3]),
        linked ? linked[4]! : null,
      );
      if (html) blocks.push(html);
      continue;
    }
    const button = line.match(BUTTON_LINE_RE);
    if (button) {
      flushParagraph();
      blocks.push(
        `${BUTTON_TABLE}<a href="${escapeHtml(button[2]!)}" style="${BUTTON_STYLE}">${escapeHtml(button[1]!)}</a></td></tr></table>`,
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
  flushQuote();

  return fill(blocks.join("\n"));
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
${renderBody(content.body, values, ctx.promo)}
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
 * reviewers (it would be blank for everyone else), images from outside the
 * Blob store, a promo card with no promo, unknown `::` blocks, and buttons or
 * pictures whose link is missing or not https.
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

  // A Set, so ten broken buttons read as one note.
  const lineProblems = new Set<string>();
  for (const raw of content.body.split(/\r?\n/)) {
    const line = raw.trim();
    const directive = line.match(DIRECTIVE_RE);
    if (directive) {
      const word = directive[1]!;
      if (!isDirective(word)) {
        lineProblems.add(`"::${word}" isn't a block, so it's left out.`);
      } else if (word === "promo" && !hasPromo) {
        lineProblems.add(
          "The email has a promo card but there's no promo running, so the card would be left out.",
        );
      }
      continue;
    }
    if (PICTURE_PLACEHOLDER_RE.test(line)) {
      lineProblems.add(
        "A picture hasn't been chosen yet, so it's left out. Choose one, or delete that block.",
      );
      continue;
    }
    const linked = line.match(LINKED_IMAGE_LINE_RE);
    const image = linked ?? line.match(IMAGE_LINE_RE);
    const button = image ? null : line.match(BUTTON_LINE_RE);
    if (image && !isAllowedImageUrl(image[2]!)) {
      lineProblems.add(
        "An image wasn't added with the Picture button, so it's left out. Add it with the Picture button instead.",
      );
    }
    const link = linked?.[4] ?? button?.[2];
    if (link && !/^https:\/\//i.test(link)) {
      lineProblems.add(
        `A button or picture links to "${link}". Use an address starting https:// so email apps trust it.`,
      );
    }
    if (!image && !button && LINK_SHAPED_LINE_RE.test(line)) {
      lineProblems.add(
        `"${line}" looks like a button or picture, but its link is missing or isn't a web address, so it would show as typed.`,
      );
    }
  }
  problems.push(...lineProblems);
  return problems;
}
