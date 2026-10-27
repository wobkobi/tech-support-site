// src/features/mailing/lib/render.ts
// Renders a mailing-list email to recipient HTML and text. Backs the preview, test send
// and real send so all three match; pure, with DB data arriving in the context.

import type { CampaignAudience } from "@/features/mailing/lib/audience";
import { type Block, parseBlocks } from "@/features/mailing/lib/blocks";
import {
  BOX_LINE_RE,
  BUTTON_LINE_RE,
  BUTTON_PLACEHOLDER_RE,
  DIRECTIVE_RE,
  IMAGE_LINE_RE,
  INLINE_LINK_RE,
  isDirective,
  LINKED_IMAGE_LINE_RE,
  PICTURE_PLACEHOLDER_RE,
} from "@/features/mailing/lib/body-syntax";
import { MERGE_TAG, splitName } from "@/features/mailing/lib/broadcast";
import {
  EMAIL_COLUMN_PX,
  escapeHtml,
  htmlToText,
  linkifyEscaped,
  renderNotificationEmail,
} from "@/features/reviews/lib/email-core";
import { isBlobImageUrl } from "@/shared/lib/blob-image";
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
  /** Banner one-liner: "$10 off if you book by this Saturday". */
  summary: string;
  /** Just the offer: "$10 off on jobs over $100". */
  offer: string;
  /** The last day to book it: "this Saturday" or "Sat 16 May". */
  ends: string;
  /** Weekday or time-of-day limit, like "weekdays" or "Tuesdays 9am to 5pm"; null when none. */
  restriction?: string | null;
  /** The promo's own title and description, so the AI writers know what it's for. */
  about?: string;
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
  /** Tracking tags for the site's own links; only a real send passes it. */
  tracking?: LinkTracking;
}

/** Which site gets tagged links, and the email's name in the tags. */
export interface LinkTracking {
  /** Absolute site URL; links to its host get tagged. */
  siteUrl: string;
  /** `utm_campaign` value, from {@link campaignTag}. */
  campaign: string;
}

/** Placeholders the operator can type, with the help text the editor shows. */
export const PLACEHOLDERS = [
  { key: "firstName", help: 'First name, or "there" when unknown' },
  { key: "name", help: 'Full name, or "there" when unknown' },
  { key: "promo", help: "The promo in one line, with its end date" },
  { key: "promoOffer", help: 'Just the offer, like "$10 off"' },
  { key: "promoEnds", help: "The last day to book it" },
  { key: "reviewText", help: "Their own review from your site (reviewers only)" },
] as const;

type PlaceholderKey = (typeof PLACEHOLDERS)[number]["key"];

const PROMO_KEYS: ReadonlySet<string> = new Set(["promo", "promoOffer", "promoEnds"]);
const KNOWN_KEYS: ReadonlySet<string> = new Set(PLACEHOLDERS.map((p) => p.key));

/** A `{word}` placeholder anywhere in the text. */
const PLACEHOLDER_RE = /\{(\w+)\}/g;

/**
 * A whole line shaped like a button or picture (optionally linked), to catch one whose
 * link is missing or not a web address before it goes out as raw brackets.
 */
const LINK_SHAPED_LINE_RE = /^\[?!?\[[^\]\n]*\]\([^)\n]*\)(?:\]\([^)\n]*\))?$/;

// Inline styles: email clients ignore stylesheets. 16px text for older phone readers.
const P_STYLE = "margin:0 0 14px;color:#333;font-size:16px;line-height:1.6";
const H1_STYLE = "margin:8px 0 12px;color:#0c0a3e;font-size:22px;line-height:1.3";
const H2_STYLE = "margin:8px 0 10px;color:#0c0a3e;font-size:18px;line-height:1.3";
const UL_STYLE = "margin:0 0 14px;padding-left:22px;color:#333;font-size:16px;line-height:1.6";
const LINK_STYLE = "color:#43bccd";
// Moonstone-700: white on it is 5.8:1; the brand moonstone (2.3:1) fails for 16px text.
const BUTTON_BG = "#206f79";
const BUTTON_STYLE = `display:inline-block;background:${BUTTON_BG};color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:16px`;
// Outlook ignores padding and radius on an <a>, so a one-cell table carries the colour.
const BUTTON_TABLE = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px"><tr><td style="background:${BUTTON_BG};border-radius:8px">`;
// A picture fills the card's column. A small one is half the column on a computer, and 75% of
// a phone's narrower one so it doesn't shrink to a thumbnail. Centred both ways: Outlook
// ignores the margin and the card's max-width.
const SMALL_IMAGE_PX = EMAIL_COLUMN_PX / 2;
const IMAGE_STYLE = `display:block;width:100%;max-width:${EMAIL_COLUMN_PX}px;height:auto;border:0;border-radius:8px;margin:0 auto`;
const SMALL_IMAGE_STYLE = `display:block;width:75%;max-width:${SMALL_IMAGE_PX}px;height:auto;border:0;border-radius:8px;margin:0 auto`;
// Full-width one-cell table: the reliable way to get background, border and padding.
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
// Big box: brand colour or a darkened photo under white text. bgcolor plus background-color
// keep 5.8:1 when an app (Outlook) drops the photo; the `background` attribute covers apps
// that skip the CSS one.
const BOX_CELL_STYLE = `background-color:${BUTTON_BG};background-size:cover;background-position:center;border-radius:12px;padding:40px 24px;text-align:center`;
const BOX_TEXT_SHADOW = "text-shadow:0 1px 3px rgba(0,0,0,.45)";
const BOX_HEADLINE_STYLE = `margin:0;color:#ffffff;font-size:30px;font-weight:800;line-height:1.2;${BOX_TEXT_SHADOW}`;
const BOX_LINE_STYLE = `margin:10px 0 0;color:#ffffff;font-size:18px;line-height:1.5;${BOX_TEXT_SHADOW}`;
// A white button with navy words: it stands out on the dark panel at 15:1.
const BOX_BUTTON_TABLE =
  '<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:22px auto 0"><tr><td style="background:#ffffff;border-radius:8px">';
const BOX_BUTTON_STYLE =
  "display:inline-block;background:#ffffff;color:#0c0a3e;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:16px";
const DIVIDER_HTML = '<hr style="border:0;border-top:1px solid #dde3e8;margin:22px 0" />';
const SPACER_HTML = '<div style="height:20px;line-height:20px;font-size:1px">&nbsp;</div>';
// Text links, not icons: many email apps block images, and words read better.
const SOCIAL_HTML = `<p style="${P_STYLE};text-align:center">Find us on <a href="${GOOGLE_BUSINESS_PROFILE_URL}" style="${LINK_STYLE}">Google</a> · <a href="${FACEBOOK_PAGE_URL}" style="${LINK_STYLE}">Facebook</a> · <a href="${INSTAGRAM_URL}" style="${LINK_STYLE}">Instagram</a></p>`;

/**
 * First word of a stored name, or null when there is none. Shares {@link splitName} with
 * the broadcast import, so a batch send and a broadcast greet people the same way.
 * @param name - Contact name.
 * @returns First name or null.
 */
function firstNameOf(name: string | null): string | null {
  return splitName(name).first || null;
}

/**
 * Plain-text placeholder values for one recipient; promo keys are blank with no promo
 * ({@link listProblems} warns).
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
 * Fills placeholders in the subject and preheader; an unknown `{word}` stays visible.
 * @param text - Text containing placeholders.
 * @param values - Placeholder values.
 * @returns The filled text.
 */
function fillText(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (whole, key: string) => values[key] ?? whole);
}

/**
 * Inline formatting for one escaped line: bold, `[text](url)` links, then bare URLs only
 * between explicit links so an href is never wrapped twice.
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
 * HTML for one picture, or null when its host isn't allowed.
 * @param alt - Alt text, already escaped.
 * @param url - Image URL.
 * @param small - Whether the picture is the small size.
 * @param link - Where tapping the picture goes, or null.
 * @returns The picture's HTML, or null.
 */
function pictureHtml(alt: string, url: string, small: boolean, link: string | null): string | null {
  if (!isBlobImageUrl(url)) return null;
  const img = small
    ? `<img src="${escapeHtml(url)}" alt="${alt}" width="${SMALL_IMAGE_PX}" style="${SMALL_IMAGE_STYLE}" />`
    : `<img src="${escapeHtml(url)}" alt="${alt}" width="${EMAIL_COLUMN_PX}" style="${IMAGE_STYLE}" />`;
  const inner = link ? `<a href="${escapeHtml(link)}" style="display:block">${img}</a>` : img;
  return `<p style="margin:0 0 14px;text-align:center">${inner}</p>`;
}

/**
 * HTML for a big box block, or "" with no headline. Drops a non-Blob photo and a linkless
 * button ({@link listProblems} names both).
 * @param box - The box block.
 * @returns The box's HTML.
 */
function boxHtml(box: Extract<Block, { type: "box" }>): string {
  if (!box.headline) return "";
  const background = box.photo && isBlobImageUrl(box.photo) ? escapeHtml(box.photo) : "";
  const cellAttrs = background
    ? `background="${background}" bgcolor="${BUTTON_BG}" style="${BOX_CELL_STYLE};background-image:url('${background}')"`
    : `bgcolor="${BUTTON_BG}" style="${BOX_CELL_STYLE}"`;
  const smaller = (box.line ? box.line.split("\n") : [])
    .map((l) => `<p style="${BOX_LINE_STYLE}">${renderInline(escapeHtml(l))}</p>`)
    .join("");
  const button =
    box.label && /^https?:\/\//i.test(box.url)
      ? `${BOX_BUTTON_TABLE}<a href="${escapeHtml(box.url)}" style="${BOX_BUTTON_STYLE}">${escapeHtml(box.label)}</a></td></tr></table>`
      : "";
  return `${BOX_TABLE}<tr><td ${cellAttrs}><h2 style="${BOX_HEADLINE_STYLE}">${renderInline(escapeHtml(box.headline))}</h2>${smaller}${button}</td></tr></table>`;
}

/**
 * HTML for a `::word` line: promo card, spacer or social row. An unknown word, or the
 * promo card with no promo, renders nothing.
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
  return `${BOX_TABLE}<tr><td style="${PROMO_CELL_STYLE}"><p style="${PROMO_OFFER_STYLE}">${escapeHtml(promo.offer)}</p><p style="${PROMO_ENDS_STYLE}">Book by ${escapeHtml(promo.ends)}${limit}</p></td></tr></table>`;
}

/**
 * Renders the body text to HTML. Placeholders become private-use sentinels before
 * parsing and are filled escaped after, so a name like "**Bob**" never becomes bold.
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

  // Share the editor's parser so both agree on block boundaries.
  const html = parseBlocks(tokenised)
    .map((block) => blockHtml(block, promo, fill))
    .filter(Boolean);
  return fill(html.join("\n"));
}

/**
 * HTML for one parsed block, or "" when it renders nothing (missing link, non-Blob
 * picture, blank quote, unknown `::word`).
 * @param block - The block, with placeholders still as sentinel tokens.
 * @param promo - Promo wording for the promo card, or null when none applies.
 * @param fill - Swaps sentinel tokens for their values, to test whether a quote is blank.
 * @returns The block's HTML.
 */
function blockHtml(
  block: Block,
  promo: PromoWording | null,
  fill: (text: string) => string,
): string {
  switch (block.type) {
    case "text": {
      // parseBlocks only makes a lone `::word` line from a directive it doesn't know.
      const unknownDirective = block.text.match(DIRECTIVE_RE);
      if (unknownDirective) return directiveHtml(unknownDirective[1]!, promo);
      const lines = block.text.split("\n").map((l) => renderInline(escapeHtml(l)));
      return `<p style="${P_STYLE}">${lines.join("<br>")}</p>`;
    }
    case "list": {
      const items = block.items.map((item) => `<li>${renderInline(escapeHtml(item))}</li>`);
      return `<ul style="${UL_STYLE}">${items.join("")}</ul>`;
    }
    case "heading": {
      const text = renderInline(escapeHtml(block.text));
      return block.size === "big"
        ? `<h2 style="${H1_STYLE}">${text}</h2>`
        : `<h3 style="${H2_STYLE}">${text}</h3>`;
    }
    case "button":
      if (!block.url) return "";
      return `${BUTTON_TABLE}<a href="${escapeHtml(block.url)}" style="${BUTTON_STYLE}">${escapeHtml(block.label)}</a></td></tr></table>`;
    case "picture":
      if (!block.url) return "";
      return pictureHtml(escapeHtml(block.alt), block.url, block.small, block.link || null) ?? "";
    case "box":
      return boxHtml(block);
    case "quote": {
      // Drop a quote that is blank for this recipient (empty {reviewText}).
      const text = block.text
        .split("\n")
        .map((l) => renderInline(escapeHtml(l)))
        .join("<br>");
      if (!fill(text).trim()) return "";
      const stars = "★".repeat(block.stars);
      const starsHtml = stars
        ? `<p style="${STARS_STYLE}" role="img" aria-label="${block.stars} out of 5 stars">${stars}</p>`
        : "";
      const nameHtml = block.name
        ? `<p style="${QUOTE_NAME_STYLE}">- ${renderInline(escapeHtml(block.name))}</p>`
        : "";
      return `${BOX_TABLE}<tr><td style="${QUOTE_CELL_STYLE}">${starsHtml}<p style="${QUOTE_TEXT_STYLE}">${text}</p>${nameHtml}</td></tr></table>`;
    }
    case "divider":
      return DIVIDER_HTML;
    case "promo":
      return directiveHtml("promo", promo);
    case "spacer":
      return directiveHtml("space", promo);
    case "social":
      return directiveHtml("social", promo);
  }
}

/** A rendered email: subject, preview text, the full HTML document and its plain-text part. */
export interface RenderedCampaign {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

/**
 * Renders one recipient's copy of a campaign.
 * @param content - Subject, preheader and body as the operator wrote them.
 * @param recipient - Who this copy is for.
 * @param ctx - Brand, signature, promo wording and unsubscribe link.
 * @returns The filled email.
 */
export function renderCampaign(
  content: CampaignContent,
  recipient: CampaignRecipient,
  ctx: RenderContext,
): RenderedCampaign {
  return renderWith(content, placeholderValues(recipient, ctx.promo), ctx);
}

/**
 * Renders the single copy a Resend broadcast sends to everyone. Names, the review and the
 * unsubscribe link become {@link MERGE_TAG} tags that Resend fills from each contact;
 * promo wording and link tags are filled here as usual.
 * @param content - Subject, preheader and body as the operator wrote them.
 * @param ctx - Brand, signature, promo wording and link tracking.
 * @returns The email with merge tags in place.
 */
export function renderBroadcast(
  content: CampaignContent,
  ctx: Omit<RenderContext, "unsubscribeUrl">,
): RenderedCampaign {
  const values = {
    ...placeholderValues({ name: null }, ctx.promo),
    firstName: MERGE_TAG.firstName,
    name: MERGE_TAG.name,
    reviewText: MERGE_TAG.reviewText,
  };
  return renderWith(content, values, { ...ctx, unsubscribeUrl: MERGE_TAG.unsubscribeUrl });
}

/**
 * Shared body of {@link renderCampaign} and {@link renderBroadcast}.
 * @param content - Subject, preheader and body as the operator wrote them.
 * @param values - Placeholder values, real or merge tags.
 * @param ctx - Brand, signature, promo wording and unsubscribe link.
 * @returns The filled email.
 */
function renderWith(
  content: CampaignContent,
  values: Record<PlaceholderKey, string>,
  ctx: RenderContext,
): RenderedCampaign {
  const subject = fillText(content.subject, values).trim();
  const preheader = content.preheader ? fillText(content.preheader, values).trim() : "";

  // The preheader is hidden in the body; inboxes read it as the preview line.
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>`
    : "";
  const footer = `<p style="margin:24px 0 0;font-size:13px;color:#888;line-height:1.5">You're getting this because you've had help from ${escapeHtml(ctx.brand)}. If you'd rather not get emails like this, you can <a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:#888">unsubscribe</a>.</p>`;

  // Tagging runs before the footer goes on, so the unsubscribe link is never touched.
  const bodyHtml = `${renderBody(content.body, values, ctx.promo)}
${ctx.signatureHtml}`;
  const html = renderNotificationEmail(`${preheaderHtml}
${ctx.tracking ? tagLinks(bodyHtml, ctx.tracking) : bodyHtml}
${footer}
`);
  // The hidden preheader would otherwise lead the text part.
  const text = htmlToText(html.replace(preheaderHtml, ""));
  return { subject, preheader, html, text };
}

/**
 * Problems worth stopping for before a send: empty fields, bad placeholders, non-Blob
 * images, a promo card with no promo, unknown `::` blocks and non-https links.
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
  if (parseBlocks(content.body).some((b) => b.type === "box" && !b.headline.trim())) {
    lineProblems.add("A big box has no headline, so it's left out. Give it one, or delete it.");
  }
  for (const raw of content.body.split(/\r?\n/)) {
    // A big box's photo and button lines are checked like any other.
    const boxed = raw.trim().match(BOX_LINE_RE);
    const line = boxed ? boxed[1]!.trim() : raw.trim();
    if (boxed && PICTURE_PLACEHOLDER_RE.test(line)) continue;
    const boxPhoto = boxed ? line.match(IMAGE_LINE_RE) : null;
    if (boxPhoto) {
      if (!isBlobImageUrl(boxPhoto[2]!)) {
        lineProblems.add(
          "The big box's photo wasn't added with its photo buttons, so the box shows plain colour. Pick the photo again.",
        );
      }
      continue;
    }
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
    const waiting = line.match(BUTTON_PLACEHOLDER_RE);
    if (waiting) {
      lineProblems.add(
        `The "${waiting[1]}" button has no link yet, so it's left out. Pick where it goes, or delete that block.`,
      );
      continue;
    }
    const linked = line.match(LINKED_IMAGE_LINE_RE);
    const image = linked ?? line.match(IMAGE_LINE_RE);
    const button = image ? null : line.match(BUTTON_LINE_RE);
    if (image && !isBlobImageUrl(image[2]!)) {
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

/**
 * The email's `utm_campaign`: the subject as a slug, placeholders dropped so every copy
 * shares one name.
 * @param subject - The subject as typed, before placeholders are filled.
 * @returns A lowercase slug of up to 60 characters, or "email" when nothing is left.
 */
export function campaignTag(subject: string): string {
  const slug = subject
    .replace(PLACEHOLDER_RE, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return slug || "email";
}

/**
 * Adds UTM tags to every link to the site, skipping other hosts, unsubscribe/API links
 * and links with their own `utm_source`. hrefs arrive escaped, so `&amp;` is undone first.
 * @param html - Rendered HTML.
 * @param tracking - The site and the email's tag.
 * @returns The HTML with the site's links tagged.
 */
export function tagLinks(html: string, tracking: LinkTracking): string {
  const host = new URL(tracking.siteUrl).hostname.replace(/^www\./, "");
  return html.replace(/href="(https?:\/\/[^"]+)"/g, (whole, href: string) => {
    let url: URL;
    try {
      url = new URL(href.replace(/&amp;/g, "&"));
    } catch {
      return whole;
    }
    if (url.hostname.replace(/^www\./, "") !== host) return whole;
    if (/^\/(unsubscribe|api)(\/|$)/.test(url.pathname)) return whole;
    if (url.searchParams.has("utm_source")) return whole;
    url.searchParams.set("utm_source", "newsletter");
    url.searchParams.set("utm_medium", "email");
    url.searchParams.set("utm_campaign", tracking.campaign);
    return `href="${escapeHtml(url.toString())}"`;
  });
}
