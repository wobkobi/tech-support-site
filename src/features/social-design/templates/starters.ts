// src/features/social-design/templates/starters.ts
// The four starter templates in house style, laid out by hand per core size. Sample words are
// placeholders so no review is made up; line breaks are explicit so line counts are known.

import type { PictureKind } from "@/features/mailing/lib/ai-draft";
import { LOGOS, TEXT_PRESETS, type TextPreset } from "@/features/social-design/lib/brand";
import type { DesignKind } from "@/features/social-design/lib/design-row";
import {
  DOC_VERSION,
  type DesignDoc,
  type Layer,
  type LayerRole,
  type TextLayer,
} from "@/features/social-design/lib/doc";
import { CORE_FORMATS, EMAIL_PICTURE_FORMAT } from "@/features/social-design/lib/formats";
import { makeLayer, type AddKind } from "@/features/social-design/lib/new-layer";
import {
  bulletsBox,
  cardLayout,
  col,
  frameFor,
  row,
  textBox,
  type Box,
  type Frame,
  type Node,
} from "@/features/social-design/templates/stack";

/** A starter template ready to seed. */
export interface StarterTemplate {
  /** Name plus version, like "review@1"; a new version seeds a new row, so edited copies are kept. */
  templateKey: string;
  name: string;
  kind: Exclude<DesignKind, "blank">;
  doc: DesignDoc;
}

/** Live addresses a template points at. */
export interface StarterContext {
  bookingUrl: string;
}

/**
 * A new layer from the Add menu's defaults.
 * @param add - What to add.
 * @returns The layer.
 */
function layer(add: AddKind): Layer {
  return makeLayer(add).layer;
}

/**
 * A preset text layer with its words and role.
 * @param preset - Style preset.
 * @param words - Words, with line breaks written in.
 * @param name - Layer name in the layers list.
 * @param role - What the words are for, or null.
 * @param extra - Fields to change from the preset.
 * @returns Text layer.
 */
function text(
  preset: TextPreset,
  words: string,
  name: string,
  role: LayerRole | null,
  extra: Partial<TextLayer> = {},
): TextLayer {
  const base = layer({ kind: "text", preset }) as TextLayer;
  return { ...base, text: words, name, role, ...extra };
}

/**
 * How much bigger an email picture's words and logo are on {@link EMAIL_PICTURE_FORMAT}. A phone
 * shows the picture about 330px wide, a quarter of its 1200, so at feed sizes the short line
 * would read at 7px and the wordmark at 55px wide; this puts them near 12px and 90px. Any
 * bigger and a two-line headline pushes the card off the picture.
 */
const EMAIL_BOOST = 1.65;

/**
 * A font size scaled to a frame, floored at feed-readable so templates pass the style checks.
 * @param size - Size on a 1080px-wide portrait post.
 * @param frame - Size's frame.
 * @returns Font size in pixels.
 */
function px(size: number, frame: Frame): number {
  return Math.max(size * frame.k * frame.boost, frame.minFont);
}

/**
 * Font size of a preset on a frame (see {@link px}).
 * @param preset - Style preset.
 * @param frame - Size's frame.
 * @param factor - Extra scale for this template.
 * @returns Font size in pixels.
 */
function fs(preset: TextPreset, frame: Frame, factor = 1): number {
  return px(TEXT_PRESETS[preset].fontSize * factor, frame);
}

/**
 * Logo box scaled to a frame.
 * @param id - Layer id.
 * @param size - Width on a 1080px-wide portrait post.
 * @param ratio - Width over height of the artwork.
 * @param frame - Size's frame.
 * @returns Box.
 */
function logoBox(id: string, size: number, ratio: number, frame: Frame): Box {
  const w = size * frame.k * frame.boost;
  return { id, w, h: w / ratio };
}

/**
 * Puts the layers and per-size layouts together into a document.
 * @param under - Backdrop and frosted card, the bottom two layers.
 * @param content - Layers on the card, bottom first.
 * @param layoutOn - Lays the content out on one size.
 * @param email - True for an email picture, whose words and logo draw bigger on the email's size.
 * @returns Document on every core size.
 */
function assemble(
  under: [Layer, Layer],
  content: Layer[],
  layoutOn: (frame: Frame) => Node,
  email = false,
): DesignDoc {
  const [backdrop, card] = under;
  const layouts: DesignDoc["layouts"] = {};
  for (const key of CORE_FORMATS) {
    const frame = frameFor(key, email && key === EMAIL_PICTURE_FORMAT ? EMAIL_BOOST : 1);
    layouts[key] = cardLayout(frame, { backdrop: backdrop.id, card: card.id }, layoutOn(frame));
  }
  return {
    version: DOC_VERSION,
    formats: [...CORE_FORMATS],
    layers: [...under, ...content],
    layouts,
    caption: "",
    altText: "",
    paidAd: false,
  };
}

/**
 * Brand backdrop and frosted card every template starts with.
 * @returns The two bottom layers.
 */
function base(): [Layer, Layer] {
  return [layer({ kind: "backdrop", source: "brand" }), layer({ kind: "frosted" })];
}

const WORDMARK = LOGOS.wordmark.ratio;
// Accent words sit on the light frosted card, where moonstone-600 and coquelicot fall
// under the style checks' 3:1 contrast; one shade darker reads and keeps the colour.
const ACCENT_ON_CARD = { colour: "moonstone-700" } as const;
const PRICE_ON_CARD = "coquelicot-600";

/**
 * Announcement: photo, headline, a line or two and the wordmark; wide sizes put the photo beside.
 * @param email - True for an email picture: no photo frame, as there's no photo to put in it,
 *   and bigger words and logo on the email's size.
 * @returns Template.
 */
function announcement(email = false): StarterTemplate {
  const under = base();
  const photo = layer({ kind: "photo-frame" });
  const logo = layer({ kind: "logo", variant: "wordmark" });
  const headline = text("headline", "Big news\nto share", "Headline", "headline");
  const support = text(
    "support",
    "Say what's new in a line\nor two here.",
    "Short line",
    "support",
  );

  const content = email ? [logo, headline, support] : [photo, logo, headline, support];
  const doc = assemble(
    under,
    content,
    (f) => {
      const { w, h } = f.inner;
      if (email) {
        return col(
          36 * f.k,
          logoBox(logo.id, 340, WORDMARK, f),
          textBox(headline.id, 2, fs("headline", f), 1.05, w),
          textBox(support.id, 2, fs("support", f), 1.3, w),
        );
      }
      if (f.wide) {
        const photoW = Math.round(w * 0.44);
        const gap = 48 * f.k;
        const right = w - photoW - gap;
        return row(
          gap,
          { id: photo.id, w: photoW, h: Math.min(h, photoW * 1.25) },
          col(
            28 * f.k,
            logoBox(logo.id, 300, WORDMARK, f),
            textBox(headline.id, 2, fs("headline", f, 0.8), 1.05, right),
            textBox(support.id, 2, fs("support", f), 1.3, right),
          ),
        );
      }
      const gap = 36 * f.k;
      const logoB = logoBox(logo.id, 340, WORDMARK, f);
      const head = textBox(headline.id, 2, fs("headline", f), 1.05, w);
      const sup = textBox(support.id, 2, fs("support", f), 1.3, w);
      // The photo takes what the words leave, up to a 16:9 frame.
      const photoH = Math.min(w * 0.5625, h - logoB.h - head.h - sup.h - gap * 3);
      return col(gap, logoB, { id: photo.id, w, h: photoH }, head, sup);
    },
    email,
  );
  return { templateKey: "announcement@2", name: "Announcement", kind: "announcement", doc };
}

/**
 * Review: quote mark, the review's words, five stars, who said it and the logo mark.
 * @returns Template.
 */
function review(): StarterTemplate {
  const under = base();
  const mark = layer({ kind: "quote-mark" });
  const quote = text(
    "support",
    "Paste the review here.\nKeep it to two or three\nshort lines.",
    "Review words",
    "quote",
    { weight: 600, colour: "russian-violet" },
  );
  const stars = layer({ kind: "stars" });
  const name = text("small", "Name, Suburb", "Who said it", "name", { weight: 700 });
  const logo = layer({ kind: "logo", variant: "mark" });

  const doc = assemble(under, [mark, quote, stars, name, logo], (f) => {
    const { w } = f.inner;
    return col(
      32 * f.k,
      { id: mark.id, w: 110 * f.k, h: 92 * f.k },
      textBox(quote.id, 3, fs("support", f, 1.18), 1.3, w),
      { id: stars.id, w: 300 * f.k, h: 60 * f.k },
      textBox(name.id, 1, fs("small", f), 1.35, w),
      logoBox(logo.id, 90, LOGOS.mark.ratio, f),
    );
  });
  return { templateKey: "review@2", name: "Review", kind: "review", doc };
}

/**
 * Tech tip: lightbulb, "TECH TIP", headline and up to four ticked points (beside on landscape).
 * @param email - True for an email picture, with bigger words and logo on the email's size.
 * @returns Template.
 */
function tip(email = false): StarterTemplate {
  const under = base();
  const icon = layer({ kind: "icon", icon: "FaLightbulb" });
  const accent = text("accent", "TECH TIP", "Tip label", null, ACCENT_ON_CARD);
  const headline = text("headline", "Speed up a\nslow laptop", "Headline", "headline");
  const bullets = {
    ...layer({ kind: "bullets" }),
    items: ["Restart it once a week", "Install updates when asked", "Remove apps you don't use"],
  } as Layer;
  const logo = layer({ kind: "logo", variant: "wordmark" });

  const doc = assemble(
    under,
    [icon, accent, headline, bullets, logo],
    (f) => {
      const { w } = f.inner;
      const gap = 33 * f.k;
      const iconB: Box = { id: icon.id, w: 90 * f.k, h: 90 * f.k };
      const accentB = textBox(accent.id, 1, fs("accent", f), 1.2, w);
      const logoB = logoBox(logo.id, 300, WORDMARK, f);
      if (f.key === "landscape") {
        // With bigger words the points take more of the width, so a 28-letter point still fits
        // on one line; the headline drops a size to keep a dozen letters to its narrower line.
        const big = f.boost > 1;
        const left = Math.round(w * (big ? 0.38 : 0.42));
        const between = 48 * f.k;
        return row(
          between,
          col(
            gap,
            iconB,
            { ...accentB, w: left },
            textBox(headline.id, 2, fs("headline", f, big ? 0.7 : 1), 1.05, left),
            logoB,
          ),
          bulletsBox(bullets.id, 3, fs("support", f, big ? 0.9 : 1), w - left - between),
        );
      }
      return col(
        gap,
        iconB,
        accentB,
        textBox(headline.id, 2, fs("headline", f), 1.05, w),
        // Narrower than the card so the ticks sit under the headline, not out at the edge.
        bulletsBox(bullets.id, 3, fs("support", f), Math.min(w, 760 * f.k)),
        logoB,
      );
    },
    email,
  );
  return { templateKey: "tip@2", name: "Tech tip", kind: "tip", doc };
}

/**
 * Promo: live offer and end date, headline, booking QR with "Scan to book", and contact details.
 * @param ctx - Live addresses.
 * @param email - True for an email picture, with bigger words and logo on the email's size.
 * @returns Template.
 */
function promo(ctx: StarterContext, email = false): StarterTemplate {
  const under = base();
  const logo = layer({ kind: "logo", variant: "wordmark" });
  // The summary says the offer and when it ends ("... until this Friday") in one line.
  const offer = {
    ...layer({ kind: "promo", field: "summary" }),
    weight: 800,
    colour: PRICE_ON_CARD,
  } as Layer;
  const headline = text("headline", "Get your tech\nsorted", "Headline", "headline");
  const qr = layer({ kind: "qr", url: ctx.bookingUrl });
  const scan = text("accent", "Scan to book", "Scan line", null, ACCENT_ON_CARD);
  const contact = layer({ kind: "contact", fields: ["phone", "website"] });

  const doc = assemble(
    under,
    [logo, offer, headline, qr, scan, contact],
    (f) => {
      const { w } = f.inner;
      const gap = 32 * f.k;
      const textW = f.wide ? Math.round(w * 0.58) : w;
      const words = col(
        gap,
        logoBox(logo.id, 300, WORDMARK, f),
        // The summary's length depends on the promo; two lines is the usual.
        textBox(offer.id, 2, px(60, f), 1.2, textW),
        textBox(headline.id, 2, fs("headline", f, 0.84), 1.05, textW),
      );
      const qrSide = (f.wide ? 240 : 200) * f.k;
      const sideW = f.wide ? w - textW - 48 * f.k : Math.min(w - qrSide - gap, 460 * f.k);
      const booking = col(
        14 * f.k,
        textBox(scan.id, 1, fs("accent", f), 1.2, sideW),
        textBox(contact.id, 2, px(32, f), 1.4, sideW),
      );
      if (f.wide) {
        return row(48 * f.k, words, col(gap, { id: qr.id, w: qrSide, h: qrSide }, booking));
      }
      return col(gap, words, row(gap, { id: qr.id, w: qrSide, h: qrSide }, booking));
    },
    email,
  );
  return { templateKey: "promo@2", name: "Promo", kind: "promo", doc };
}

/**
 * Every starter template, in the order they show under Start a design.
 * @param ctx - Live addresses.
 * @returns Templates.
 */
export function starterTemplates(ctx: StarterContext): StarterTemplate[] {
  return [announcement(), review(), tip(), promo(ctx)];
}

/**
 * A starter for a picture drafted alongside an email. Built fresh rather than copied from the
 * stored templates, since an email picture has no photo to fill a frame with.
 * @param kind - Which look.
 * @param ctx - Live addresses.
 * @returns Template.
 */
export function emailPictureStarter(kind: PictureKind, ctx: StarterContext): StarterTemplate {
  if (kind === "promo") return promo(ctx, true);
  if (kind === "announcement" || kind === "thanks") return announcement(true);
  const t = tip(true);
  if (kind === "tip") return t;
  const layers = t.doc.layers.map((l): Layer => {
    if (l.type === "icon") return { ...l, icon: "FaShieldHalved" };
    if (l.type === "text" && l.name === "Tip label") return { ...l, text: "SCAM WARNING" };
    return l;
  });
  return { ...t, name: "Scam warning", doc: { ...t.doc, layers } };
}
