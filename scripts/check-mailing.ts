// scripts/check-mailing.ts
// Mailing-list logic that must be right before anything reaches a customer: rendering,
// placeholders, tokens, recipients, templates, blocks and quiet hours. No DB, no network.
// Run with: npm test -- mailing

import { fillBlocks, readDraft, type AiDraft } from "@/features/mailing/lib/ai-draft";
import {
  emptyBlock,
  isEmptyBlock,
  parseBlocks,
  serializeBlocks,
  type Block,
} from "@/features/mailing/lib/blocks";
import { optOutActionFor } from "@/features/mailing/lib/delivery-events";
import { emailInsertGroups, emailLinkTargets } from "@/features/mailing/lib/insertables";
import { selectRecipients, type PoolContact } from "@/features/mailing/lib/recipients";
import {
  campaignTag,
  listProblems,
  renderBody,
  renderCampaign,
  tagLinks,
  type RenderContext,
} from "@/features/mailing/lib/render";
import { chunk } from "@/features/mailing/lib/send";
import { starterPresets, V2_PRESET_KEYS } from "@/features/mailing/lib/starter-presets";
import {
  BLANK_TEMPLATE,
  matchTemplate,
  switchTemplate,
  type Template,
} from "@/features/mailing/lib/templates";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "@/features/mailing/lib/unsubscribe-token";
import { nextSendTime, type QuietHours } from "@/shared/lib/quiet-hours";
import { nzWallClockUtc } from "@/shared/lib/timezone-utils";
import { expect, finish } from "./lib/harness.js";

// Read per call, so this survives import hoisting
process.env.UNSUBSCRIBE_SECRET = "check-mailing-fixture-secret";

const BLOB_IMAGE = "https://abc123.public.blob.vercel-storage.com/mailing/image-x1.jpg";
const VALUES = {
  firstName: "Sam",
  name: "Sam Taylor",
  promo: "",
  promoOffer: "",
  promoEnds: "",
  reviewText: "",
};

const CTX: RenderContext = {
  brand: "To the Point Tech",
  signatureHtml: "<p>SIGNATURE</p>",
  promo: { summary: "$10 off until Friday", offer: "$10 off", ends: "Friday 3 October" },
  unsubscribeUrl: "https://example.test/unsubscribe/abc.def",
};

/** Escaping: nothing the operator or a contact types can become live HTML. */
function checkEscaping(): void {
  console.log("Escaping");
  const html = renderBody("Hello <script>alert(1)</script>", VALUES);
  expect(
    "a script tag comes out inert",
    !html.includes("<script>") && html.includes("&lt;script&gt;"),
  );

  const sneaky = renderBody("Hi {name}", { ...VALUES, name: "**Bob** <b>x</b>" });
  expect("a placeholder value isn't read as bold", !sneaky.includes("<strong>"), sneaky);
  expect("a placeholder value's HTML is escaped", sneaky.includes("&lt;b&gt;x&lt;/b&gt;"), sneaky);

  const buttonName = renderBody("{name}", { ...VALUES, name: "[Click](https://evil.test)" });
  expect("a placeholder value can't become a button", !buttonName.includes("href="), buttonName);

  const js = renderBody("[Click me](javascript:alert(1))", VALUES);
  expect("a javascript: link is left as text", !js.includes('href="javascript'), js);
}

/** The formatting rules the helper strip inserts. */
function checkFormatting(): void {
  console.log("Formatting");
  expect("# makes a heading", renderBody("# Big news", VALUES).includes("<h2"));
  expect("## makes a smaller heading", renderBody("## Smaller", VALUES).includes("<h3"));
  expect(
    "**text** is bold",
    renderBody("This is **important**", VALUES).includes("<strong>important</strong>"),
  );

  const list = renderBody("- one\n- two\n* three", VALUES);
  expect(
    "dash and star lines make one list",
    (list.match(/<li>/g) ?? []).length === 3 && (list.match(/<ul/g) ?? []).length === 1,
    list,
  );

  const paras = renderBody("first\n\nsecond", VALUES);
  expect("a blank line splits paragraphs", (paras.match(/<p /g) ?? []).length === 2, paras);
  const joined = renderBody("line one\nline two", VALUES);
  expect(
    "a single newline is a line break",
    joined.includes("<br>") && (joined.match(/<p /g) ?? []).length === 1,
    joined,
  );

  const button = renderBody("[Book a time](https://example.test/booking)", VALUES);
  expect(
    "a line that is only a link is a button",
    button.includes('href="https://example.test/booking"') && button.includes("padding:12px 28px"),
    button,
  );
  const inline = renderBody("See [the site](https://example.test) for more", VALUES);
  expect(
    "a link inside a sentence is a plain link",
    inline.includes('href="https://example.test"') && !inline.includes("padding:12px 28px"),
    inline,
  );
}

/** Images only from the site's Blob store. */
function checkImages(): void {
  console.log("Images");
  expect(
    "a Blob image renders",
    renderBody(`![A photo](${BLOB_IMAGE})`, VALUES).includes(`<img src="${BLOB_IMAGE}"`),
  );
  const outside = renderBody("![x](https://elsewhere.test/a.jpg)", VALUES);
  expect("an image from another host is dropped", !outside.includes("<img"), outside);
  const lookalike = renderBody(
    "![x](https://public.blob.vercel-storage.com.evil.test/a.jpg)",
    VALUES,
  );
  expect("a lookalike host is dropped", !lookalike.includes("<img"), lookalike);
  const problems = listProblems(
    { subject: "s", preheader: null, body: "![x](https://elsewhere.test/a.jpg)" },
    false,
  );
  expect(
    "an outside image is listed as a problem",
    problems.some((p) => p.includes("Picture button")),
    problems.join(" | "),
  );
}

/** Placeholders, fallbacks and the problem list. */
function checkPlaceholders(): void {
  console.log("Placeholders");
  const full = renderCampaign(
    {
      subject: "Hi {firstName}",
      preheader: "{promo}",
      body: "Hello {firstName}, {promoOffer} ends {promoEnds}.",
    },
    { name: "Sam Taylor" },
    CTX,
  );
  expect("subject gets the first name", full.subject === "Hi Sam", full.subject);
  expect("body gets promo wording", full.html.includes("$10 off ends Friday 3 October"));
  expect(
    "preheader is hidden in the body",
    full.html.includes("display:none") && full.html.includes("$10 off until Friday"),
  );
  expect(
    "text part doesn't open with the preheader",
    !full.text.trimStart().startsWith("$10 off until Friday"),
    full.text.slice(0, 80),
  );
  expect("footer carries the unsubscribe link", full.html.includes(CTX.unsubscribeUrl));
  expect("signature is included", full.html.includes("SIGNATURE"));

  const noName = renderCampaign(
    { subject: "Hi {firstName}", preheader: null, body: "x" },
    { name: "  " },
    CTX,
  );
  expect('a blank name falls back to "there"', noName.subject === "Hi there", noName.subject);

  expect(
    "an unknown placeholder stays visible",
    renderBody("Hi {nmae}", VALUES).includes("{nmae}"),
  );
  const typo = listProblems({ subject: "Hi", preheader: null, body: "Hi {nmae}" }, true);
  expect(
    "an unknown placeholder is a problem",
    typo.some((p) => p.includes("{nmae}")),
    typo.join(" | "),
  );

  const noPromo = listProblems({ subject: "{promo}", preheader: null, body: "x" }, false);
  expect(
    "a promo placeholder with no promo is a problem",
    noPromo.length === 1,
    noPromo.join(" | "),
  );
  expect(
    "a promo placeholder with a promo is fine",
    listProblems({ subject: "{promo}", preheader: null, body: "x" }, true).length === 0,
  );
  expect(
    "an empty subject and body are problems",
    listProblems({ subject: " ", preheader: null, body: "" }, true).length === 2,
  );

  const review = renderCampaign(
    { subject: "Hi", preheader: null, body: "You said:\n{reviewText}" },
    { name: "Sam", reviewText: "Fixed my <b>laptop</b> **fast**" },
    CTX,
  );
  expect(
    "{reviewText} fills in escaped, never as formatting",
    review.html.includes("Fixed my &lt;b&gt;laptop&lt;/b&gt; **fast**"),
    review.html,
  );
  const noReview = renderCampaign(
    { subject: "Hi", preheader: null, body: "You said: [{reviewText}]" },
    { name: "Sam" },
    CTX,
  );
  expect("{reviewText} is blank without a review", noReview.html.includes("You said: []"));
  const reviewContent = { subject: "Hi", preheader: null, body: "{reviewText}" };
  expect(
    "{reviewText} on an everyone email is a problem",
    listProblems(reviewContent, true).some((p) => p.includes("{reviewText}")),
  );
  expect(
    "{reviewText} on a reviewers email is fine",
    listProblems(reviewContent, true, "site_reviewers").length === 0,
  );
}

/** Unsubscribe tokens: forgeries and mangled links are refused. */
function checkTokens(): void {
  console.log("Unsubscribe tokens");
  const id = "65a1b2c3d4e5f6a7b8c9d0e1";
  const other = "65a1b2c3d4e5f6a7b8c9d0e2";
  const token = signUnsubscribeToken(id);
  expect("a signed token verifies to its contact", verifyUnsubscribeToken(token) === id);

  const [, sig] = token.split(".");
  expect(
    "a signature moved to another id is refused",
    verifyUnsubscribeToken(`${other}.${sig}`) === null,
  );
  expect(
    "a tampered signature is refused",
    verifyUnsubscribeToken(`${token.slice(0, -2)}xx`) === null,
  );
  expect("a cut-short token is refused", verifyUnsubscribeToken(token.slice(0, 30)) === null);
  expect("an extra segment is refused", verifyUnsubscribeToken(`${token}.x`) === null);
  expect("a non-id is refused", verifyUnsubscribeToken(`not-an-id.${sig}`) === null);

  process.env.UNSUBSCRIBE_SECRET = "a-different-secret";
  expect("a token from another secret is refused", verifyUnsubscribeToken(token) === null);
  delete process.env.UNSUBSCRIBE_SECRET;
  expect("nothing verifies with no secret set", verifyUnsubscribeToken(token) === null);
  process.env.UNSUBSCRIBE_SECRET = "check-mailing-fixture-secret";
}

/** Who gets an email. */
function checkRecipients(): void {
  console.log("Recipients");
  const pool: PoolContact[] = [
    { id: "a", name: "Ann", email: "Ann@Example.com", altEmails: [] },
    { id: "b", name: "Ann again", email: "ann@example.com ", altEmails: [] },
    { id: "c", name: "Cat", email: "cat@example.com", altEmails: [] },
    { id: "d", name: "Dan", email: "dan@example.com", altEmails: [] },
    { id: "e", name: "Eve", email: "new-eve@example.com", altEmails: [] },
    { id: "f", name: "No email", email: null, altEmails: [] },
  ];
  const result = selectRecipients(
    pool,
    [
      { email: "cat@example.com", contactId: null },
      { email: "old-eve@example.com", contactId: "e" },
    ],
    new Set(["d"]),
  );
  /**
   * Joins contact ids for a readable comparison.
   * @param rows - Recipients in one group.
   * @returns Comma-separated ids.
   */
  const ids = (rows: { contactId: string }[]): string => rows.map((r) => r.contactId).join(",");
  expect("a shared address gets one copy", ids(result.recipients) === "a", ids(result.recipients));
  expect("emails are lowercased and trimmed", result.recipients[0]?.email === "ann@example.com");
  expect("an opted-out address is skipped", ids(result.optedOut).includes("c"));
  expect(
    "an opt-out follows the contact after an email change",
    ids(result.optedOut).includes("e"),
  );
  const reasons = selectRecipients(
    pool,
    [
      { email: "cat@example.com", contactId: null, source: "bounce" },
      { email: "dan@example.com", contactId: "d", source: "complaint" },
      { email: "new-eve@example.com", contactId: "e", source: "link" },
    ],
    new Set(),
  ).optedOut;
  expect(
    "a bounce or spam report shows its reason; a reader's own unsubscribe has none",
    reasons.find((r) => r.contactId === "c")?.optOutReason === "bounce" &&
      reasons.find((r) => r.contactId === "d")?.optOutReason === "complaint" &&
      reasons.find((r) => r.contactId === "e")?.optOutReason === undefined,
    JSON.stringify(reasons),
  );
  expect("an unticked contact is excluded", ids(result.excluded) === "d", ids(result.excluded));
  const all = [...result.recipients, ...result.excluded, ...result.optedOut];
  expect("a contact with no email is left out", !all.some((r) => r.contactId === "f"));

  const narrowed = selectRecipients(
    pool,
    [{ email: "cat@example.com", contactId: null }],
    new Set(["d"]),
    new Set(["c", "d", "e"]),
  );
  expect(
    "an audience keeps only its contacts, in every group",
    ids(narrowed.recipients) === "e" &&
      ids(narrowed.excluded) === "d" &&
      ids(narrowed.optedOut) === "c",
    `${ids(narrowed.recipients)} / ${ids(narrowed.excluded)} / ${ids(narrowed.optedOut)}`,
  );
}

/** Batches of up to 100 for Resend. */
function checkChunking(): void {
  console.log("Chunking");
  const sizes = chunk(
    Array.from({ length: 250 }, (_, i) => i),
    100,
  ).map((c) => c.length);
  expect("250 splits into 100, 100, 50", sizes.join(",") === "100,100,50", sizes.join(","));
  expect("nothing makes no chunks", chunk([], 100).length === 0);
}

/**
 * Whether two optional instants are the same moment (both null counts as the same).
 * @param a - First instant.
 * @param b - Second instant.
 * @returns True when they match.
 */
function sameInstant(a: Date | null, b: Date | null): boolean {
  return a?.getTime() === b?.getTime();
}

/**
 * Quiet hours: a send inside the window waits for its closing hour, the right day,
 * including across the April daylight-saving change.
 */
function checkQuietHours(): void {
  console.log("Quiet hours");
  const night: QuietHours = { enabled: true, startHour: 21, endHour: 7 };

  expect(
    "10:30pm waits for 7am tomorrow",
    sameInstant(
      nextSendTime(night, nzWallClockUtc(2026, 10, 10, 22, 30)),
      nzWallClockUtc(2026, 10, 11, 7),
    ),
  );
  expect(
    "3am waits for 7am the same day",
    sameInstant(
      nextSendTime(night, nzWallClockUtc(2026, 10, 11, 3)),
      nzWallClockUtc(2026, 10, 11, 7),
    ),
  );
  expect(
    "9pm on the dot is already quiet",
    nextSendTime(night, nzWallClockUtc(2026, 10, 10, 21)) !== null,
  );
  expect("7am on the dot can go", nextSendTime(night, nzWallClockUtc(2026, 10, 11, 7)) === null);
  expect("midday can go", nextSendTime(night, nzWallClockUtc(2026, 10, 11, 12)) === null);
  expect(
    "switched off never holds",
    nextSendTime({ ...night, enabled: false }, nzWallClockUtc(2026, 10, 10, 23)) === null,
  );
  expect(
    "a window inside one day (1am to 5am) holds 2am until 5am",
    sameInstant(
      nextSendTime({ enabled: true, startHour: 1, endHour: 5 }, nzWallClockUtc(2026, 10, 11, 2)),
      nzWallClockUtc(2026, 10, 11, 5),
    ),
  );
  // NZDT ends at 3am on 4 April 2027, so the 7am release is NZST (UTC+12).
  const overDst = nextSendTime(night, nzWallClockUtc(2027, 4, 3, 22));
  expect(
    "the night daylight saving ends still releases at 7am NZST",
    overDst?.toISOString() === "2027-04-03T19:00:00.000Z",
    overDst?.toISOString() ?? "null",
  );
}

/** Switching template keeps edited fields and replaces untouched ones. */
function checkTemplates(): void {
  console.log("Templates");
  const scam: Template = {
    id: "scam",
    name: "Scam warning",
    subject: "Watch out for this scam",
    preheader: "A quick heads up",
    body: "Hi {firstName},\n\nScam text.",
  };
  const promo: Template = {
    id: "promo",
    name: "New promo",
    subject: "Something for you",
    preheader: "",
    body: "Hi {firstName},\n\n{promo}",
  };
  const all = [BLANK_TEMPLATE, scam, promo];

  const fromBlank = switchTemplate(BLANK_TEMPLATE, BLANK_TEMPLATE, scam);
  expect("untouched blank > template copies the body", fromBlank.body === scam.body);
  expect("untouched blank > template copies the name", fromBlank.name === scam.name);

  const edited = { ...scam, subject: "My own subject" };
  const switched = switchTemplate(edited, scam, promo);
  expect("an edited subject is kept", switched.subject === "My own subject");
  expect("an untouched body follows the new template", switched.body === promo.body);
  expect("an untouched name follows the new template", switched.name === promo.name);
  expect("an untouched preview text follows the new template", switched.preheader === "");

  const ownBody = { ...scam, body: "Hi {firstName},\n\nWe're closed 20-27 Dec." };
  expect("an edited body is kept", switchTemplate(ownBody, scam, promo).body === ownBody.body);
  expect(
    "a trailing newline doesn't count as an edit",
    switchTemplate({ ...scam, body: scam.body + "\n\n" }, scam, promo).body === promo.body,
  );
  expect(
    "with no known template, filled fields are kept and empty ones replaced",
    (() => {
      const r = switchTemplate(
        { ...BLANK_TEMPLATE, subject: "Mine", body: "Mine too" },
        null,
        scam,
      );
      return r.subject === "Mine" && r.body === "Mine too" && r.preheader === scam.preheader;
    })(),
  );

  expect("a fresh blank email matches Blank", matchTemplate(BLANK_TEMPLATE, all) === "blank");
  expect("a draft with a preset's body matches it", matchTemplate(edited, all) === "scam");
  expect(
    "a rewritten body falls back to the subject",
    matchTemplate({ ...scam, body: "Rewritten" }, all) === "scam",
  );
  expect(
    "nothing in common matches nothing",
    matchTemplate({ name: "x", subject: "x", preheader: "", body: "x" }, all) === null,
  );
}

/** The editor's Add menu: every item has to come out of the renderer as intended. */
function checkInsertables(): void {
  console.log("Add menu");
  const details = {
    siteUrl: "https://example.co.nz",
    website: "example.co.nz",
    phone: "021 000 0000",
    email: "me@example.co.nz",
  };
  const reviewUrl = "https://g.page/r/example/review";
  const items = emailInsertGroups(details, CTX.promo, reviewUrl).flatMap((g) => g.items);
  const byLabel = new Map(items.map((i) => [i.label, i]));
  expect("labels are unique (they key the menu buttons)", byLabel.size === items.length);
  expect(
    "the review button opens the Google review box from settings, and goes when that's blank",
    byLabel.get("Leave a Google review")?.text === `[Leave a Google review](${reviewUrl})` &&
      !emailInsertGroups(details, CTX.promo, " ")
        .flatMap((g) => g.items)
        .some((i) => i.label === "Leave a Google review"),
  );
  const targets = emailLinkTargets(details.siteUrl, reviewUrl);
  expect(
    "the link picker offers the review box before the profile, and drops it when blank",
    targets.findIndex((t) => t.url === reviewUrl) >= 0 &&
      targets.findIndex((t) => t.url === reviewUrl) <
        targets.findIndex((t) => t.label.startsWith("Google profile")) &&
      !emailLinkTargets(details.siteUrl, "").some((t) => t.label === "Leave a Google review"),
  );

  const placeholders = items.filter((i) => i.text.startsWith("{"));
  expect(
    "offers the name and review placeholders and the three promo ones",
    placeholders.map((i) => i.text).join(" ") ===
      "{firstName} {name} {reviewText} {promo} {promoOffer} {promoEnds}",
  );
  // Reviewers audience, so {reviewText} counts as known rather than misplaced.
  expect(
    "every offered placeholder is one the renderer knows",
    placeholders.every(
      (i) =>
        listProblems({ subject: "Hi", preheader: null, body: i.text }, true, "site_reviewers")
          .length === 0,
    ),
  );
  expect(
    "a running promo shows its wording as the hint",
    byLabel.get("When it ends")?.hint === "Friday 3 October",
  );

  const button = byLabel.get("Book a time");
  expect(
    "a button item renders as a button to the booking page",
    button?.line === true &&
      renderBody(button.text, VALUES).includes(
        '<a href="https://example.co.nz/booking" style="display:inline-block',
      ),
    button?.text,
  );
  const link = renderBody(`See our ${byLabel.get("Prices page")?.text} for more.`, VALUES);
  expect(
    "a link item renders inline, inside the sentence",
    link.includes('See our <a href="https://example.co.nz/pricing"') &&
      link.includes(">prices page</a> for more."),
    link,
  );
  const website = renderBody(byLabel.get("Website")?.text ?? "", VALUES);
  expect(
    "the website links its address once",
    website.split("<a ").length === 2 && website.includes(">example.co.nz</a>"),
    website,
  );
  expect("phone comes from the details", byLabel.get("Phone number")?.text === "021 000 0000");
}

/** The block lines: promo card, quote, divider, spacer, social row, picture options. */
function checkBlockRendering(): void {
  console.log("Block rendering");
  const promo = renderBody("::promo", VALUES, CTX.promo);
  expect(
    "the promo card shows the offer and end date",
    promo.includes(">$10 off</p>") && promo.includes("Ends Friday 3 October</p>"),
    promo,
  );
  const limited = renderBody("::promo", VALUES, { ...CTX.promo!, restriction: "weekdays" });
  expect(
    "the promo card names a weekday limit",
    limited.includes("Ends Friday 3 October, weekdays only"),
    limited,
  );
  expect("no promo leaves the card out", renderBody("::promo", VALUES, null) === "");
  expect(
    "a picture still to choose is left out",
    renderBody("![A picture of the van]()\n\nAfter", VALUES).startsWith("<p") &&
      !renderBody("![A picture of the van]()", VALUES).includes("van"),
  );

  const quote = renderBody("> ★★★★\n> Fixed it **fast**.\n> - Pat, Avondale", VALUES);
  expect(
    "a quote shows its stars, text and name",
    quote.includes('aria-label="4 out of 5 stars">★★★★</p>') &&
      quote.includes("Fixed it <strong>fast</strong>.") &&
      quote.includes(">- Pat, Avondale</p>"),
    quote,
  );
  const ownReview = renderBody("> {reviewText}", { ...VALUES, reviewText: "<b>Great</b>" });
  expect(
    "a {reviewText} quote fills in escaped",
    ownReview.includes("&lt;b&gt;Great&lt;/b&gt;"),
    ownReview,
  );
  expect(
    "a quote that comes out blank is left out",
    renderBody("> ★★★★★\n> {reviewText}", VALUES) === "",
  );
  const nameOnly = renderBody("> - Pat", VALUES);
  expect(
    "a lone dash line in a quote is its text, not a name",
    nameOnly.includes('font-style:italic">- Pat</p>'),
    nameOnly,
  );

  expect("--- is a divider", renderBody("---", VALUES).startsWith("<hr"));
  expect("::space is a gap", renderBody("::space", VALUES).includes("&nbsp;"));
  const social = renderBody("::social", VALUES);
  expect(
    "::social links Google, Facebook and Instagram",
    (social.match(/<a href="https:\/\//g) ?? []).length === 3,
    social,
  );
  expect("an unknown ::word renders nothing", renderBody("::mystery", VALUES) === "");

  const full = renderBody(`![Shop](${BLOB_IMAGE})`, VALUES);
  expect(
    "a picture fills the card's 560px column and is centred",
    full.includes('width="560"') &&
      full.includes("max-width:560px") &&
      full.includes("text-align:center"),
    full,
  );
  const small = renderBody(`![Shop](${BLOB_IMAGE} "small")`, VALUES);
  expect(
    'a "small" picture is half width and centred',
    small.includes('width="280"') &&
      small.includes("max-width:280px") &&
      small.includes("text-align:center"),
    small,
  );
  const linked = renderBody(`[![Shop](${BLOB_IMAGE})](https://example.test/x)`, VALUES);
  expect(
    "a linked picture is wrapped in its link",
    linked.includes(
      `<a href="https://example.test/x" style="display:block"><img src="${BLOB_IMAGE}"`,
    ),
    linked,
  );
  const linkedOutside = renderBody(
    "[![x](https://elsewhere.test/a.jpg)](https://example.test)",
    VALUES,
  );
  expect("a linked picture from another host is dropped", !linkedOutside.includes("<img"));

  const button = renderBody("[Book](https://example.test/booking)", VALUES);
  expect(
    "a button sits in a coloured table cell for Outlook",
    button.startsWith('<table role="presentation"') && button.includes("background:#206f79"),
    button,
  );

  const text = renderCampaign(
    {
      subject: "Hi",
      preheader: null,
      body: "::promo\n\n> ★★★★★\n> Great job.\n> - Pat\n\n::social",
    },
    { name: "Sam" },
    CTX,
  ).text;
  expect(
    "the text part reads the promo, quote and social links",
    text.includes("$10 off\n\nEnds Friday 3 October") &&
      text.includes("★★★★★\n\nGreat job.\n\n- Pat") &&
      text.includes("Find us on Google (https://"),
    text,
  );
}

/**
 * Problems for a body, with a promo running or not.
 * @param body - Body text.
 * @param hasPromo - Whether a promo is running.
 * @returns The problems.
 */
function problemsOf(body: string, hasPromo = true): string[] {
  return listProblems({ subject: "s", preheader: null, body }, hasPromo);
}

/** The new problems: promo card, unknown blocks, broken and http links. */
function checkBlockProblems(): void {
  console.log("Block problems");
  expect("a promo card with no promo is a problem", problemsOf("::promo", false).length === 1);
  expect("a promo card with a promo is fine", problemsOf("::promo").length === 0);
  const placeholder = problemsOf("![A picture of the van]()");
  expect(
    "a picture still to choose is one plain problem",
    placeholder.length === 1 && placeholder[0]!.includes("hasn't been chosen"),
    placeholder.join(" | "),
  );
  expect(
    "an unknown ::word is a problem",
    problemsOf("::mystery").some((p) => p.includes("::mystery")),
  );
  const waiting = problemsOf("[Book a time]()");
  expect(
    "a button with no link yet is one plain problem, and it's left out of the email",
    waiting.length === 1 &&
      waiting[0]!.includes('"Book a time" button has no link yet') &&
      !renderBody("Hi\n\n[Book a time]()", VALUES, null).includes("Book a time"),
    waiting.join(" | "),
  );
  const waitingBlocks = parseBlocks("[Book a time]()");
  expect(
    "a button with no link yet reads back as a button, not text",
    waitingBlocks.length === 1 &&
      waitingBlocks[0]!.type === "button" &&
      serializeBlocks(waitingBlocks) === "[Book a time]()",
  );
  expect(
    "an http button is a problem",
    problemsOf("[Book](http://example.test)").some((p) => p.includes("https://")),
  );
  expect(
    "an http picture link is a problem",
    problemsOf(`[![x](${BLOB_IMAGE})](http://example.test)`).some((p) => p.includes("https://")),
  );
  expect(
    "the same problem on two lines is listed once",
    problemsOf("[Book](http://example.test)\n\n[Book](http://example.test)").length === 1,
  );
  const allGood = problemsOf(
    [
      "::promo",
      "::space",
      "::social",
      "---",
      "> ★★★★★\n> Great\n> - Pat",
      `![x](${BLOB_IMAGE} "small")`,
      `[![x](${BLOB_IMAGE})](https://example.test)`,
      "[Book](https://example.test)",
    ].join("\n\n"),
  );
  expect("every block line done right has no problems", allGood.length === 0, allGood.join(" | "));
}

/** Bodies that must survive a parse and re-serialise without the email changing. */
const ROUND_TRIP_FIXTURES = [
  "Hi {firstName},\n\nline one\nline two\n- touching list\n* star item\nafter list",
  "Hi there,\r\n\r\n# Big\r\n## Small\r\nText right under\r\n",
  "> ★★★★★\n> Great\n> - Pat\n\n> just text\n>\n> - name only",
  "> - lone name line\n\n>\n\n> ★★",
  "::promo\n::space\n::social\n::mystery\n---\nafter divider",
  `![a](${BLOB_IMAGE})\n![b](${BLOB_IMAGE} "small")\n[![c](${BLOB_IMAGE})](https://example.test)\n[Book](https://example.test)`,
  "[Book a time]()\n[not a button](see below)\n### three hashes\n#nospace",
  "**{firstName}**, see [the site](https://example.test) - {promo}\n- {promoOffer} item\n> {reviewText}",
  "\n\n\nlots\n\n\n\nof gaps\n\n\n",
  `>> ![](${BLOB_IMAGE})\n>> Lock in **today's** rate, {firstName}\n>> Before it ends\n>> and soon\n>> [Book](https://example.test)\n> ★★★★★\n> after the box`,
  ">> Just a headline\n>>\n>> [Waiting]()\n\n>> ![]()\n>> no photo yet\n\n>> [Only a button](https://example.test)",
];

/**
 * Re-serialises a body through the blocks.
 * @param body - Body text.
 * @returns The re-serialised body, or null when the rendered email changed.
 */
function roundTrip(body: string): string | null {
  const values = { ...VALUES, reviewText: "Good stuff" };
  const again = serializeBlocks(parseBlocks(body));
  const same = renderBody(again, values, CTX.promo) === renderBody(body, values, CTX.promo);
  return same ? again : null;
}

/** The AI draft's reading and its fill into the blocks. */
function checkAiDraft(): void {
  console.log("AI draft");
  expect(
    "a reply with no heading or paragraphs is no draft",
    readDraft({ subject: "Hi" }) === null,
  );
  expect("a reply that isn't an object is no draft", readDraft("text") === null);
  const read = readDraft({
    subject: "  Home visits out west  ",
    paragraphs: ["One.", 7, "", "Two."],
    bullets: "not a list",
    buttonText: "Book a time",
    extra: "ignored",
  });
  expect(
    "a reply is trimmed, wrong shapes drop out and missing parts come back empty",
    read?.subject === "Home visits out west" &&
      read.paragraphs.join("|") === "One.|Two." &&
      read.bullets.length === 0 &&
      read.heading === "" &&
      read.preheader === "",
    JSON.stringify(read),
  );
  const curly = readDraft({
    heading: "We’re open “late”",
    paragraphs: ["One more thing – I’d love a review—thanks.", "Open 9–5 weekdays."],
  });
  expect(
    "curly quotes come back straight and dashes as plain hyphens",
    curly?.heading === `We're open "late"` &&
      curly.paragraphs[0] === "One more thing - I'd love a review - thanks." &&
      curly.paragraphs[1] === "Open 9-5 weekdays.",
    JSON.stringify(curly),
  );

  const draft: AiDraft = {
    subject: "s",
    preheader: "p",
    heading: "New heading",
    paragraphs: ["First para.", "Second para."],
    bullets: ["One", "Two"],
    buttonText: "Read more",
    buttonUrl: "",
  };
  /**
   * Fills a body's blocks with the test draft.
   * @param body - Body text.
   * @returns The filled body text.
   */
  const fillOf = (body: string): string => serializeBlocks(fillBlocks(parseBlocks(body), draft));
  const tip = starterPresets("https://example.co.nz").find((p) => p.presetKey === "tip")!;
  const filledTip = fillOf(tip.body);
  expect(
    "a template is filled by position: heading, first paragraph after the greeting, list, button words",
    filledTip.startsWith(
      [
        "Hi {firstName},",
        "# New heading",
        "First para.",
        "Second para.",
        "## How to do it",
        "- One\n- Two",
      ].join("\n\n"),
    ) && filledTip.endsWith("[Read more](https://example.co.nz/booking)"),
    JSON.stringify(filledTip),
  );
  expect(
    "an empty email gets a greeting, then every part in order, and a button still needing a link",
    fillOf("") ===
      [
        "Hi {firstName},",
        "# New heading",
        "First para.",
        "Second para.",
        "- One\n- Two",
        "[Read more]()",
      ].join("\n\n"),
    JSON.stringify(fillOf("")),
  );
  const announcement = starterPresets("https://example.co.nz").find(
    (p) => p.presetKey === "announcement",
  )!;
  expect(
    "a heading above the greeting is filled in place and the picture slot stays first",
    fillOf(announcement.body).startsWith(
      [
        "![A picture that goes with your news]()",
        "# New heading",
        "Hi {firstName},",
        "First para.",
      ].join("\n\n"),
    ),
    JSON.stringify(fillOf(announcement.body)),
  );

  const twice = serializeBlocks(
    fillBlocks(parseBlocks(fillOf("")), { ...draft, paragraphs: ["New one.", "New two."] }),
  );
  expect(
    "drafting again swaps the paragraphs and the button instead of adding more",
    twice ===
      [
        "Hi {firstName},",
        "# New heading",
        "New one.",
        "New two.",
        "- One\n- Two",
        "[Read more]()",
      ].join("\n\n"),
    JSON.stringify(twice),
  );
  const written = fillOf("Hi {firstName},\n\nMy own words.\n\nMore of mine.\n\n---\n\nKept below.");
  expect(
    "words already after the greeting are replaced up to the next other block, and the rest stays",
    written.includes("First para.\n\nSecond para.") &&
      !written.includes("My own words") &&
      !written.includes("More of mine") &&
      written.includes("---\n\nKept below."),
    JSON.stringify(written),
  );
  const linked = { ...draft, buttonUrl: "https://example.co.nz/reviews" };
  expect(
    "a new button takes the draft's link",
    serializeBlocks(fillBlocks(parseBlocks(""), linked)).endsWith(
      "[Read more](https://example.co.nz/reviews)",
    ),
  );
  expect(
    "a button waiting for its link takes the draft's link",
    serializeBlocks(fillBlocks(parseBlocks("Hi {firstName},\n\n[Old words]()"), linked)).endsWith(
      "[Read more](https://example.co.nz/reviews)",
    ),
  );
  expect(
    "a button that has a link keeps it",
    serializeBlocks(
      fillBlocks(parseBlocks("Hi {firstName},\n\n[Old](https://example.co.nz/booking)"), linked),
    ).endsWith("[Read more](https://example.co.nz/booking)"),
  );
}

/** The block editor's parse and serialise. */
function checkBlocks(): void {
  console.log("Blocks");
  for (const preset of starterPresets("https://example.co.nz")) {
    const again = roundTrip(preset.body);
    expect(`preset "${preset.name}" renders the same after a round trip`, again !== null);
    expect(
      `preset "${preset.name}" body is unchanged by a round trip`,
      again === preset.body,
      JSON.stringify(again),
    );
  }
  ROUND_TRIP_FIXTURES.forEach((body, i) => {
    const again = roundTrip(body);
    expect(
      `fixture ${i + 1} renders the same after a round trip`,
      again !== null,
      JSON.stringify(body),
    );
    expect(
      `fixture ${i + 1} settles after one round trip`,
      again !== null && serializeBlocks(parseBlocks(again)) === again,
      JSON.stringify(again),
    );
  });

  // A paragraph closed by a standalone line must not share its id
  const idBody = "Para\n# H\nMore\n[Go](https://example.test)\n> q\n\n- a";
  const ids = parseBlocks(idBody).map((b) => b.id);
  expect("parsed block ids are unique", new Set(ids).size === ids.length, ids.join(","));
  expect(
    "parsing the same body twice gives the same ids (server and browser agree)",
    ids.join(",") ===
      parseBlocks(idBody)
        .map((b) => b.id)
        .join(","),
  );
  expect(
    "an id prefix keeps a re-parse's ids apart from the first",
    parseBlocks(idBody, "r1-").every((b) => !ids.includes(b.id)),
  );

  const [wanted] = parseBlocks("![A picture of the van]()");
  expect(
    "a picture still to choose parses as an empty Picture block that keeps its words",
    wanted?.type === "picture" && wanted.url === "" && wanted.alt === "A picture of the van",
  );
  expect(
    "a blank new Picture block is left out, a described one stays as a placeholder",
    serializeBlocks([emptyBlock("picture")]) === "" &&
      serializeBlocks([{ ...emptyBlock("picture"), alt: "Van" } as Block]) === "![Van]()",
  );
  const keys = starterPresets("https://example.co.nz").map((p) => p.presetKey);
  expect(
    "every later preset key is a starter, and keys are unique",
    V2_PRESET_KEYS.every((k) => keys.includes(k)) && new Set(keys).size === keys.length,
  );

  const types = parseBlocks(
    `# H\n\nPara\n- a\n- b\n\n[Go](https://example.test)\n![p](${BLOB_IMAGE})\n> q\n\n::promo\n---\n::space\n::social\n::mystery`,
  ).map((b) => b.type);
  expect(
    "each line becomes its block type",
    types.join(" ") === "heading text list button picture quote promo divider spacer social text",
    types.join(" "),
  );
  const quote = parseBlocks("> ★★★\n> one\n> two\n> - Pat")[0];
  expect(
    "a quote reads its stars, text and name",
    quote?.type === "quote" &&
      quote.stars === 3 &&
      quote.text === "one\ntwo" &&
      quote.name === "Pat",
    JSON.stringify(quote),
  );
  const picture = parseBlocks(`[![p](${BLOB_IMAGE} "small")](https://example.test)`)[0];
  expect(
    "a picture reads its size and link",
    picture?.type === "picture" && picture.small && picture.link === "https://example.test",
    JSON.stringify(picture),
  );

  const empties = (["heading", "text", "list", "button", "picture", "quote"] as const).map((type) =>
    emptyBlock(type),
  );
  expect(
    "empty blocks are left out of the body",
    serializeBlocks([...empties, { id: "x", type: "text", text: "Hi" }]) === "Hi" &&
      empties.every(isEmptyBlock),
  );
  expect(
    "a button with a label but no link is kept, so the problem shows",
    serializeBlocks([{ id: "x", type: "button", label: "Book", url: "" }]) === "[Book]()",
  );
  const unsafe = serializeBlocks([
    { id: "x", type: "button", label: "Book ] now\nplease", url: "https://example.test" },
  ]);
  expect(
    "brackets and line breaks can't break a button line",
    parseBlocks(unsafe)[0]?.type === "button",
    unsafe,
  );
  const built = serializeBlocks([
    { id: "1", type: "heading", text: "Spring", size: "small" },
    { id: "2", type: "list", items: ["one", " ", "two"] },
    { id: "3", type: "quote", stars: 5, text: "Great\n\njob", name: "Pat" },
    { id: "4", type: "picture", alt: "p", url: BLOB_IMAGE, small: true, link: "" },
  ]);
  expect(
    "blocks write the expected lines",
    built ===
      `## Spring\n\n- one\n- two\n\n> ★★★★★\n> Great\n> job\n> - Pat\n\n![p](${BLOB_IMAGE} "small")`,
    JSON.stringify(built),
  );
}

/** Link tracking: only the site's own links get tagged, and only on a real send. */
function checkTracking(): void {
  console.log("Link tracking");
  expect(
    "the tag is the subject as a slug, with placeholders dropped",
    campaignTag("{firstName}, a quick update & 20% off!") === "a-quick-update-20-off" &&
      campaignTag("{firstName}") === "email",
  );
  const tracking = { siteUrl: "https://tothepoint.co.nz", campaign: "spring" };
  const tagged = tagLinks(
    [
      `<a href="https://tothepoint.co.nz/booking">`,
      `<a href="https://www.tothepoint.co.nz/pricing?x=1&amp;y=2">`,
      `<a href="https://g.page/r/abc/review">`,
      `<a href="https://tothepoint.co.nz/unsubscribe/tok">`,
      `<a href="https://tothepoint.co.nz/faq?utm_source=flyer">`,
    ].join("\n"),
    tracking,
  ).split("\n");
  const tags = "utm_source=newsletter&amp;utm_medium=email&amp;utm_campaign=spring";
  expect(
    "the site's own links get the tags, keeping any query they had",
    tagged[0] === `<a href="https://tothepoint.co.nz/booking?${tags}">` &&
      tagged[1] === `<a href="https://www.tothepoint.co.nz/pricing?x=1&amp;y=2&amp;${tags}">`,
    tagged.slice(0, 2).join(" | "),
  );
  expect(
    "other sites, unsubscribe links and links with their own tags are left alone",
    tagged[2] === `<a href="https://g.page/r/abc/review">` &&
      tagged[3] === `<a href="https://tothepoint.co.nz/unsubscribe/tok">` &&
      tagged[4] === `<a href="https://tothepoint.co.nz/faq?utm_source=flyer">`,
    tagged.slice(2).join(" | "),
  );
  const content = {
    subject: "Spring",
    preheader: "",
    body: "[Book](https://tothepoint.co.nz/booking)",
  };
  const unsub = { ...CTX, unsubscribeUrl: "https://tothepoint.co.nz/unsubscribe/abc" };
  const live = renderCampaign(content, { name: "Sam" }, { ...unsub, tracking }).html;
  const test = renderCampaign(content, { name: "Sam" }, unsub).html;
  expect(
    "a real send tags the button but never the unsubscribe link; a test send tags nothing",
    live.includes("booking?utm_source=newsletter") &&
      live.includes(`href="https://tothepoint.co.nz/unsubscribe/abc"`) &&
      !test.includes("utm_"),
  );
}

/** Resend webhooks: which events take an address off the list, and why. */
function checkDeliveryEvents(): void {
  console.log("Delivery events");
  /**
   * A webhook event of a type, to one address, with extra data.
   * @param type - Event type.
   * @param extra - Extra `data` fields.
   * @returns The event.
   */
  const event = (type: string, extra: Record<string, unknown> = {}): unknown => ({
    type,
    data: { email_id: "x", to: ["Sam Taylor <Sam@Example.com>"], ...extra },
  });
  const hard = optOutActionFor(event("email.bounced", { bounce: { type: "Permanent" } }));
  expect(
    "a hard bounce drops the bare, lowercased address",
    hard?.source === "bounce" && hard.emails.join() === "sam@example.com",
    JSON.stringify(hard),
  );
  expect(
    "a soft bounce leaves the list alone",
    optOutActionFor(event("email.bounced", { bounce: { type: "Transient" } })) === null,
  );
  expect(
    "a spam report is a complaint",
    optOutActionFor(event("email.complained"))?.source === "complaint",
  );
  expect(
    "a suppressed send follows Resend's reason",
    optOutActionFor(event("email.suppressed", { suppressed: { type: "Complaint" } }))?.source ===
      "complaint" &&
      optOutActionFor(event("email.suppressed", { suppressed: { type: "Bounce" } }))?.source ===
        "bounce",
  );
  expect(
    "sent, delivered and opened events, and junk, change nothing",
    optOutActionFor(event("email.delivered")) === null &&
      optOutActionFor(event("email.opened")) === null &&
      optOutActionFor({ type: "email.complained", data: { to: ["not an address"] } }) === null &&
      optOutActionFor(null) === null,
  );
}

/** The big box: a coloured panel with a large headline, smaller lines, a button and a photo. */
function checkBox(): void {
  console.log("Big box");
  const full = [
    `>> ![](${BLOB_IMAGE})`,
    ">> Lock in today's rate, {firstName}",
    ">> Book before Friday",
    ">> [Book a time](https://example.test/booking)",
  ].join("\n");
  const html = renderBody(full, VALUES);
  expect(
    "the photo sits behind the box, with the brand colour for apps that drop it",
    html.includes(`background="${BLOB_IMAGE}"`) &&
      html.includes(`background-image:url('${BLOB_IMAGE}')`) &&
      html.includes('bgcolor="#206f79"'),
    html,
  );
  expect(
    "the headline is large and filled in, the smaller line follows and the button is white",
    html.includes("today&#39;s rate, Sam</h2>") &&
      html.includes(">Book before Friday</p>") &&
      html.includes('href="https://example.test/booking"') &&
      html.includes("color:#0c0a3e"),
    html,
  );
  const plain = renderBody(">> Headline only", VALUES);
  expect(
    "a box with no photo is the plain colour, with no photo attribute",
    plain.includes('bgcolor="#206f79"') && !plain.includes("background="),
    plain,
  );
  const offHost = renderBody(">> ![](https://example.test/x.jpg)\n>> Headline", VALUES);
  expect(
    "a photo from another site is dropped for the plain colour",
    !offHost.includes("example.test/x.jpg") && offHost.includes("Headline</h2>"),
    offHost,
  );
  expect(
    "a box with no headline, or a button waiting for its link, is left out",
    renderBody(`>> ![](${BLOB_IMAGE})`, VALUES) === "" &&
      !renderBody(">> Headline\n>> [Book]()", VALUES).includes("Book"),
  );
  const mixed = renderBody(">> Headline\n> A quote line", VALUES);
  expect(
    "a quote line straight after a box is its own quote, not part of the box",
    mixed.includes("Headline</h2>") && mixed.includes("A quote line") && !mixed.includes("&gt;"),
    mixed,
  );

  /**
   * Problems for a body, with a promo running.
   * @param body - Body text.
   * @returns The problems listed.
   */
  const problems = (body: string): string[] =>
    listProblems({ subject: "s", preheader: "", body }, true);
  expect(
    "a box with no headline is listed as a problem",
    problems(`>> ![](${BLOB_IMAGE})`).some((p) => p.includes("no headline")),
  );
  expect(
    "a box button waiting for its link is listed, and so is a photo from another site",
    problems(">> Headline\n>> [Book]()").some((p) => p.includes('"Book" button')) &&
      problems(">> ![](https://example.test/x.jpg)\n>> Headline").some((p) =>
        p.includes("big box's photo"),
      ),
  );
  expect("a complete box has no problems", problems(full).length === 0, problems(full).join());

  const [box] = parseBlocks(full);
  expect(
    "a box parses into its photo, headline, smaller lines and button",
    box?.type === "box" &&
      box.photo === BLOB_IMAGE &&
      box.headline === "Lock in today's rate, {firstName}" &&
      box.line === "Book before Friday" &&
      box.label === "Book a time" &&
      box.url === "https://example.test/booking",
    JSON.stringify(box),
  );
  expect(
    "a box with no headline yet is empty and left out of the body",
    serializeBlocks([
      {
        id: "x",
        type: "box",
        photo: BLOB_IMAGE,
        headline: " ",
        line: "words",
        label: "Go",
        url: "",
      },
    ]) === "",
  );
  expect("a box written back is unchanged", serializeBlocks(parseBlocks(full)) === full);
}

/** Runs every group and exits non-zero on any failure. */
function main(): void {
  checkEscaping();
  checkFormatting();
  checkImages();
  checkBlockRendering();
  checkBlockProblems();
  checkBlocks();
  checkBox();
  checkAiDraft();
  checkTracking();
  checkDeliveryEvents();
  checkPlaceholders();
  checkTokens();
  checkRecipients();
  checkChunking();
  checkTemplates();
  checkInsertables();
  checkQuietHours();
  finish();
}

main();
