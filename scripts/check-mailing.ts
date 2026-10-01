// scripts/check-mailing.ts
// Mailing-list logic that has to be right before anything reaches a customer: the
// renderer's escaping and formatting rules, placeholder filling, the image allow-list,
// unsubscribe token signing, recipient selection, batch chunking and template switching. Pure logic, no
// database and no network.
// Run with: npm run check:mailing

import { selectRecipients, type PoolContact } from "@/features/mailing/lib/recipients";
import {
  listProblems,
  renderBody,
  renderCampaign,
  type RenderContext,
} from "@/features/mailing/lib/render";
import { chunk } from "@/features/mailing/lib/send";
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

// The token helpers read the secret on each call, so setting it here still takes
// effect despite import hoisting.
process.env.UNSUBSCRIBE_SECRET = "check-mailing-fixture-secret";

let failures = 0;

/**
 * Records one assertion, so every case runs even after one fails.
 * @param label - Human-readable case name.
 * @param ok - Whether the case passed.
 * @param detail - Extra output shown on failure.
 */
function expect(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
    failures++;
  }
}

const BLOB_IMAGE = "https://abc123.public.blob.vercel-storage.com/mailing/image-x1.jpg";
const VALUES = { firstName: "Sam", name: "Sam Taylor", promo: "", promoOffer: "", promoEnds: "" };

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
  expect("an unticked contact is excluded", ids(result.excluded) === "d", ids(result.excluded));
  const all = [...result.recipients, ...result.excluded, ...result.optedOut];
  expect("a contact with no email is left out", !all.some((r) => r.contactId === "f"));
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

/** Runs every group and exits non-zero on any failure. */
function main(): void {
  checkEscaping();
  checkFormatting();
  checkImages();
  checkPlaceholders();
  checkTokens();
  checkRecipients();
  checkChunking();
  checkTemplates();
  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
