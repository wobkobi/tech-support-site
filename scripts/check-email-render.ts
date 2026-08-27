// scripts/check-email-render.ts
// Renders outbound emails through their real send functions and asserts the HTML and the
// derived text/plain part both survive. fetch is stubbed at the Resend transport, so
// nothing is delivered and no quota is spent, and the fixtures carry hostile input (tags,
// entities, a URL) so escaping and the anchor rewrite are exercised, not assumed.
//
// Only sends that do NOT read settings run here: getSettings wraps its query in
// unstable_cache, which needs a Next request context, so the eleven settings-dependent
// sends throw "incrementalCache missing" outside the server. The preview routes cover
// those (/api/admin/preview-review-email, /api/business/invoices/[id]/preview-email).
//
// --conditions is required, not optional: email.ts reaches pricing-policy.server.ts,
// which imports `server-only` - a package that throws on the default condition and is
// empty under `react-server`, the condition Next builds with.
// Run with:
//   npx dotenv -e .env.local -- tsx --conditions=react-server scripts/check-email-render.ts

import {
  sendBusinessEnquiryNotification,
  sendOwnerBookingNotification,
  sendOwnerReviewNotification,
  type BusinessEnquiryData,
} from "@/features/reviews/lib/email";

// Read inside the send functions rather than at module load, so setting them
// here still takes effect despite import hoisting. A fake key is a second line
// of defence behind the fetch stub: a real send would 401 rather than deliver.
process.env.RESEND_API_KEY ??= "re_fixture_key";
process.env.EMAIL_FROM ??= "fixture@example.test";
process.env.ADMIN_EMAIL ??= "admin@example.test";

/** One intercepted Resend payload. */
interface Sent {
  subject: string;
  html: string;
  text: string;
}

const sent: Sent[] = [];

// Intercept the Resend transport. Everything else falls through to real fetch;
// Prisma talks to Mongo over its own driver, not this.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  // Match on the host, not a substring: "resend.com" appearing anywhere in a
  // path would otherwise stub an unrelated request and let the run pass on a
  // send that never happened.
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // Relative or malformed URL - never the Resend transport.
  }
  if (host !== "resend.com" && !host.endsWith(".resend.com")) return realFetch(input, init);
  const body = JSON.parse(String(init?.body ?? "{}")) as Partial<Sent>;
  sent.push({ subject: body.subject ?? "", html: body.html ?? "", text: body.text ?? "" });
  return new Response(JSON.stringify({ id: "fixture-message-id" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

// Hostile-ish customer input: a tag, an entity, repeated "<head" and a bare URL.
// The tag must survive into the text part as literal characters and must never
// reach the HTML unescaped.
const PAYLOAD = "<script>alert(1)</script> & <head><head><head> see https://example.test/x";

const inHour = new Date(Date.now() + 60 * 60 * 1000);
const inTwoHours = new Date(Date.now() + 2 * 60 * 60 * 1000);

const booking = {
  id: "fixture-booking",
  name: "Ada <b>Lovelace</b>",
  email: "ada@example.test",
  notes: `Laptop won't boot.\n${PAYLOAD}`,
  startAt: inHour,
  endAt: inTwoHours,
  cancelToken: "fixture-cancel-token",
  promoTitleAtBooking: "Winter <special>",
  address: "1 Queen Street & Co, Auckland",
  meetingType: "in_person" as const,
  rescheduleCount: 0,
};

const enquiry: BusinessEnquiryData = {
  company: "Acme <Ltd> & Sons",
  name: "Ada <b>Lovelace</b>",
  email: "ada@example.test",
  phone: "021 000 0000",
  needs: `Need 12 machines imaged.\n${PAYLOAD}`,
  interest: "Managed IT",
  urgency: "This week",
};

/** Markup that must never survive into the text/plain part. */
const TEMPLATE_RESIDUE = [
  /<p[\s>]/i,
  /<div[\s>]/i,
  /<a\s+href/i,
  /<h[1-6][\s>]/i,
  /<br\s*\/?>/i,
  /style="/i,
  /margin:0/i, // CSS leaking out of <head> or <style>
  /<!DOCTYPE/i,
];

/** Entities the reverse pass must have decoded. */
const UNDECODED = [/&nbsp;/, /&quot;/, /&#39;/, /&lt;/, /&gt;/, /&amp;/];

let failures = 0;

/**
 * Records a failed assertion.
 * @param ok - Whether the assertion held.
 * @param label - What was being asserted.
 */
function check(ok: boolean, label: string): void {
  if (!ok) {
    failures++;
    console.log(`    FAIL  ${label}`);
  }
}

/**
 * Runs one send, then asserts the intercepted HTML and text parts.
 * @param name - Label for the report.
 * @param send - Thunk invoking the send function under test.
 * @returns Resolves once the case has been asserted.
 */
async function renderCase(name: string, send: () => Promise<unknown>): Promise<void> {
  const before = sent.length;
  console.log(`\n  ${name}`);
  try {
    await send();
  } catch (err) {
    failures++;
    console.log(`    FAIL  threw: ${String(err)}`);
    return;
  }
  if (sent.length === before) {
    failures++;
    console.log("    FAIL  produced no send");
    return;
  }

  const { subject, html, text } = sent[sent.length - 1];
  console.log(`    subject: ${subject}`);

  check(html.length > 200, "html is empty or truncated");
  check(/<html/i.test(html), "html has no <html> element");
  check(text.trim().length > 40, "text part is empty or trivial");
  check(!/<script>alert/i.test(html), "unescaped <script> reached the HTML");

  for (const re of TEMPLATE_RESIDUE) {
    check(!re.test(text), `template markup survived into text: ${re}`);
  }
  for (const re of UNDECODED) {
    check(!re.test(text), `undecoded entity in text: ${re}`);
  }

  // Anchors must carry their destination: a text reader cannot follow a link it
  // cannot see.
  if (/<a\s+href="https?:/i.test(html)) {
    check(/\(https?:\/\//.test(text), "html had links but text kept no URL");
  }

  for (const line of text
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 4)) {
    console.log(`    | ${line.slice(0, 96)}`);
  }
}

/**
 * Renders every in-scope case and reports the tally.
 * @returns Resolves once all cases have run.
 */
async function main(): Promise<void> {
  await renderCase("owner review notification", () =>
    sendOwnerReviewNotification({
      id: "fixture-review",
      text: `Great service.\n${PAYLOAD}`,
      firstName: "Ada",
      lastName: "<b>Lovelace</b>",
      isAnonymous: false,
      verified: false,
    }),
  );
  await renderCase("owner booking notification", () => sendOwnerBookingNotification(booking));
  await renderCase("owner booking rescheduled", () =>
    sendOwnerBookingNotification(booking, { kind: "rescheduled", previousStartAt: inHour }),
  );
  await renderCase("business enquiry notification", () => sendBusinessEnquiryNotification(enquiry));

  console.log(
    `\n${failures === 0 ? "All email renders passed." : `${failures} assertion(s) failed.`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
