// scripts/check-social.ts
// Social posting logic that has to be right before anything goes public: each
// platform's validator, promo placeholder filling, turning an email into a post, the
// JPEG size reader, how per-platform outcomes roll up into the post status, how a
// take-down is recorded, and the composer's PATCH parsing. Pure logic, no database
// and no network.
// Run with: npm run check:social

import { postFromEmail } from "@/features/social/lib/from-email";
import { insertableGroups } from "@/features/social/lib/insertables";
import { jpegSize } from "@/features/social/lib/jpeg-size";
import { mergeTargets, parsePostPatch } from "@/features/social/lib/parse";
import {
  applyTakeDown,
  defaultTargets,
  freshRun,
  resetFailed,
  rollUpStatus,
  statusAfterTakeDown,
  takeDownDue,
  type TakeDownOutcome,
  type TargetState,
} from "@/features/social/lib/targets";
import {
  blockingIssues,
  fillPromo,
  textFor,
  validatePost,
  type PostDraft,
} from "@/features/social/lib/validate";

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

const BLOB = "https://abc.public.blob.vercel-storage.com/social/image-x1.jpg";

/**
 * A valid post for both platforms, with any fields overridden.
 * @param over - Fields to change.
 * @returns The draft.
 */
function draft(over: Partial<PostDraft> = {}): PostDraft {
  return {
    body: "Computer running slow? Book a visit.",
    imageUrl: BLOB,
    imageWidth: 1080,
    imageHeight: 1080,
    linkUrl: null,
    targets: [
      { platform: "facebook", enabled: true, textOverride: null },
      { platform: "instagram", enabled: true, textOverride: null },
    ],
    ...over,
  };
}

/**
 * Error messages for one platform.
 * @param post - The draft.
 * @param platform - Platform key.
 * @param hasPromo - Whether a promo is running.
 * @returns Its error messages.
 */
function errorsFor(post: PostDraft, platform: "facebook" | "instagram", hasPromo = true): string[] {
  return (validatePost(post, hasPromo)[platform] ?? [])
    .filter((i) => i.level === "error")
    .map((i) => i.message);
}

/** Validator rules for both platforms. */
function checkValidators(): void {
  console.log("Validators");
  expect(
    "valid post has no blocking issues",
    blockingIssues(validatePost(draft(), true)).length === 0,
  );
  expect(
    "no platform enabled blocks",
    blockingIssues(
      validatePost(
        draft({ targets: [{ platform: "facebook", enabled: false, textOverride: null }] }),
        true,
      ),
    )[0] === "Pick at least one platform.",
  );

  // Facebook
  expect(
    "facebook: text-only post is fine",
    errorsFor(draft({ imageUrl: null, imageWidth: null, imageHeight: null }), "facebook").length ===
      0,
  );
  expect(
    "facebook: empty post blocks",
    errorsFor(draft({ body: "  ", imageUrl: null }), "facebook").length === 1,
  );
  expect(
    "facebook: over 63,206 characters blocks",
    errorsFor(draft({ body: "a".repeat(63_207) }), "facebook").some((m) => m.includes("63206")),
  );

  // Instagram
  expect(
    "instagram: no picture blocks",
    errorsFor(draft({ imageUrl: null }), "instagram").includes("Instagram needs a picture."),
  );
  expect(
    "instagram: PNG blocks",
    errorsFor(draft({ imageUrl: BLOB.replace(".jpg", ".png") }), "instagram").includes(
      "Instagram only takes JPEG pictures.",
    ),
  );
  expect(
    ".jpeg extension passes",
    errorsFor(draft({ imageUrl: BLOB.replace(".jpg", ".jpeg") }), "instagram").length === 0,
  );
  expect(
    "instagram: unknown size blocks",
    errorsFor(draft({ imageWidth: null }), "instagram").some((m) => m.includes("size is unknown")),
  );
  expect(
    "instagram: 4:5 portrait passes",
    errorsFor(draft({ imageWidth: 960, imageHeight: 1200 }), "instagram").length === 0,
  );
  expect(
    "instagram: 1.91:1 landscape passes",
    errorsFor(draft({ imageWidth: 1146, imageHeight: 600 }), "instagram").length === 0,
  );
  expect(
    "instagram: 9:16 portrait blocks",
    errorsFor(draft({ imageWidth: 675, imageHeight: 1200 }), "instagram").some((m) =>
      m.includes("4:5"),
    ),
  );
  expect(
    "instagram: 2:1 landscape blocks",
    errorsFor(draft({ imageWidth: 1200, imageHeight: 600 }), "instagram").some((m) =>
      m.includes("4:5"),
    ),
  );
  expect(
    "instagram: 300px wide blocks",
    errorsFor(draft({ imageWidth: 300, imageHeight: 300 }), "instagram").some((m) =>
      m.includes("pixels wide"),
    ),
  );
  expect(
    "instagram: 1600px wide blocks",
    errorsFor(draft({ imageWidth: 1600, imageHeight: 1600 }), "instagram").some((m) =>
      m.includes("pixels wide"),
    ),
  );
  expect(
    "instagram: over 2,200 characters blocks",
    errorsFor(draft({ body: "a".repeat(2_201) }), "instagram").some((m) => m.includes("2200")),
  );
  const tags = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(" ");
  expect(
    "instagram: 31 hashtags blocks",
    errorsFor(draft({ body: tags }), "instagram").some((m) => m.includes("hashtags")),
  );
  expect(
    "instagram: 30 hashtags passes",
    errorsFor(draft({ body: tags.replace(" #tag30", "") }), "instagram").length === 0,
  );
  const mentions = Array.from({ length: 21 }, (_, i) => `@user${i}`).join(" ");
  expect(
    "instagram: 21 mentions blocks",
    errorsFor(draft({ body: mentions }), "instagram").some((m) => m.includes("@mentions")),
  );
  expect(
    "instagram: an email address isn't a mention",
    errorsFor(draft({ body: Array(25).fill("help@example.co.nz").join(" ") }), "instagram")
      .length === 0,
  );
  const linkIssues =
    validatePost(draft({ linkUrl: "https://example.co.nz" }), true).instagram ?? [];
  expect(
    "instagram: a link warns but doesn't block",
    linkIssues.some((i) => i.level === "warning") && !linkIssues.some((i) => i.level === "error"),
  );

  // Placeholders
  expect(
    "{firstName} blocks",
    errorsFor(draft({ body: "Hi {firstName}" }), "facebook").some((m) =>
      m.includes("only works in emails"),
    ),
  );
  expect(
    "a misspelt placeholder blocks",
    errorsFor(draft({ body: "{promoo}" }), "facebook").some((m) =>
      m.includes("isn't a placeholder"),
    ),
  );
  expect(
    "{promo} with no promo running blocks",
    errorsFor(draft({ body: "{promo}" }), "facebook", false).some((m) =>
      m.includes("running promo"),
    ),
  );
  expect(
    "{promo} with a promo running passes",
    errorsFor(draft({ body: "{promo}" }), "facebook", true).length === 0,
  );
  expect(
    "a platform override is validated instead of the body",
    errorsFor(
      draft({
        body: "{firstName}",
        targets: [{ platform: "facebook", enabled: true, textOverride: "Fine" }],
      }),
      "facebook",
    ).length === 0,
  );
}

/** Override selection and promo filling. */
function checkFilling(): void {
  console.log("Filling");
  const post = draft({
    targets: [
      { platform: "facebook", enabled: true, textOverride: "FB only" },
      { platform: "instagram", enabled: true, textOverride: "   " },
    ],
  });
  expect("override wins when typed", textFor(post, "facebook") === "FB only");
  expect("blank override falls back to the body", textFor(post, "instagram") === post.body);
  const promo = { summary: "10% off", offer: "10% off labour", ends: "31 October" };
  expect(
    "promo placeholders fill",
    fillPromo("{promo} - {promoOffer} until {promoEnds}", promo) ===
      "10% off - 10% off labour until 31 October",
  );
  expect("promo placeholders blank with no promo", fillPromo("x{promo}y", null) === "xy");
  expect(
    "other placeholders stay visible",
    fillPromo("{firstName} {wat}", promo) === "{firstName} {wat}",
  );
}

/** Email body to post. */
function checkFromEmail(): void {
  console.log("From email");
  const out = postFromEmail(
    [
      "Hi {firstName},",
      "",
      "## Spring tune-up",
      "",
      "Get **10% off** this month. See [our prices](https://tothepoint.co.nz/pricing).",
      "",
      "![A laptop on a desk](https://abc.public.blob.vercel-storage.com/mailing/a.jpg)",
      "![Second](https://abc.public.blob.vercel-storage.com/mailing/b.jpg)",
      "",
      "[Book now](https://tothepoint.co.nz/booking)",
      "[Call](https://tothepoint.co.nz/contact)",
    ].join("\r\n"),
  );
  expect(
    "greeting, heading markers and bold stripped; inline link spelt out",
    out.body ===
      "Spring tune-up\n\nGet 10% off this month. See our prices (https://tothepoint.co.nz/pricing).",
    JSON.stringify(out.body),
  );
  expect("first button becomes the link", out.linkUrl === "https://tothepoint.co.nz/booking");
  expect(
    "first picture becomes the image",
    out.imageUrl === "https://abc.public.blob.vercel-storage.com/mailing/a.jpg" &&
      out.imageAlt === "A laptop on a desk",
  );
  const bare = postFromEmail("Just text");
  expect("no button or picture leaves them null", bare.linkUrl === null && bare.imageUrl === null);
  const reviewer = postFromEmail("Thanks again.\nYou wrote: {reviewText}\nSee you soon.");
  expect(
    "a line with someone's own review is dropped",
    reviewer.body === "Thanks again.\nSee you soon.",
    JSON.stringify(reviewer.body),
  );
}

/** JPEG header size reader. */
function checkJpegSize(): void {
  console.log("JPEG size");
  // SOI, an APP0 segment (length 16), padding FF, then SOF0: precision 8, 800 high, 1024 wide.
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0)];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x20, 0x04, 0x00, 0x03, ...Array(9).fill(0)];
  const bytes = new Uint8Array([0xff, 0xd8, ...app0, 0xff, ...sof0]);
  const size = jpegSize(bytes);
  expect(
    "reads width and height from SOF0",
    size?.width === 1024 && size.height === 800,
    JSON.stringify(size),
  );
  // A DHT (C4) segment shares the SOF range but has no size, so it must be skipped.
  const dht = [0xff, 0xc4, 0x00, 0x04, 0x00, 0x00];
  const withDht = jpegSize(new Uint8Array([0xff, 0xd8, ...dht, ...sof0]));
  expect("skips a Huffman table segment", withDht?.width === 1024, JSON.stringify(withDht));
  expect(
    "PNG returns null",
    jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])) === null,
  );
  expect("truncated file returns null", jpegSize(new Uint8Array([0xff, 0xd8, ...app0])) === null);
}

/**
 * A target with the given outcome.
 * @param platform - Platform.
 * @param status - Outcome.
 * @param enabled - Whether it's switched on.
 * @returns The target.
 */
function target(
  platform: TargetState["platform"],
  status: TargetState["status"],
  enabled = true,
): TargetState {
  return {
    platform,
    enabled,
    textOverride: null,
    status,
    externalId: status === "posted" ? "1" : null,
    permalink: null,
    error: status === "failed" ? "boom" : null,
    postedAt: null,
    removedAt: null,
  };
}

/** Target roll-up, retry and fresh-run resets. */
function checkTargets(): void {
  console.log("Targets");
  const defaults = defaultTargets();
  expect(
    "defaults: Facebook and Instagram on, Google off",
    defaults.map((t) => `${t.platform}:${t.enabled}`).join(",") ===
      "facebook:true,instagram:true,google:false",
  );
  const g = target("google", "pending", false);
  expect(
    "all posted > posted",
    rollUpStatus([target("facebook", "posted"), target("instagram", "posted"), g]) === "posted",
  );
  expect(
    "one failed > partial",
    rollUpStatus([target("facebook", "posted"), target("instagram", "failed"), g]) === "partial",
  );
  expect(
    "all failed > failed",
    rollUpStatus([target("facebook", "failed"), target("instagram", "failed"), g]) === "failed",
  );
  expect(
    "one pending > posting",
    rollUpStatus([target("facebook", "posted"), target("instagram", "pending"), g]) === "posting",
  );
  expect(
    "a disabled pending target doesn't hold the run open",
    rollUpStatus([target("facebook", "posted"), g]) === "posted",
  );

  const retried = resetFailed([target("facebook", "posted"), target("instagram", "failed")]);
  expect(
    "retry resets only failed targets",
    retried[0]!.status === "posted" &&
      retried[1]!.status === "pending" &&
      retried[1]!.error === null,
  );
  const fresh = freshRun([target("facebook", "posted"), target("instagram", "failed"), g]);
  expect(
    "fresh run: enabled pending with outcomes cleared, disabled skipped",
    fresh[0]!.status === "pending" &&
      fresh[0]!.externalId === null &&
      fresh[1]!.status === "pending" &&
      fresh[1]!.error === null &&
      fresh[2]!.status === "skipped",
  );
}

/**
 * Take-down results keyed by platform.
 * @param entries - Platform and outcome pairs.
 * @returns The map {@link applyTakeDown} takes.
 */
function outcomes(
  entries: [TargetState["platform"], TakeDownOutcome][],
): Map<TargetState["platform"], TakeDownOutcome> {
  return new Map(entries);
}

/** Take-down bookkeeping. */
function checkTakeDown(): void {
  console.log("Take down");
  const g = target("google", "pending", false);
  const posted = [target("facebook", "posted"), target("instagram", "posted"), g];
  expect(
    "only posted targets are due",
    takeDownDue([target("facebook", "posted"), target("instagram", "failed"), g]).length === 1,
  );

  const now = new Date("2026-10-05T00:00:00Z");
  const both = applyTakeDown(
    posted.map((t) => ({ ...t, permalink: "https://x" })),
    outcomes([
      ["facebook", { ok: true }],
      ["instagram", { ok: true }],
    ]),
    now,
  );
  expect(
    "a take-down marks removed, keeps the id, drops the link",
    both[0]!.status === "removed" &&
      both[0]!.externalId === "1" &&
      both[0]!.permalink === null &&
      both[0]!.removedAt === now,
  );
  expect("nothing left up > removed", statusAfterTakeDown(both) === "removed");

  const half = applyTakeDown(
    posted,
    outcomes([
      ["facebook", { ok: true }],
      ["instagram", { ok: false, error: "no permission" }],
    ]),
    now,
  );
  expect(
    "a refused take-down stays posted with the reason",
    half[1]!.status === "posted" && half[1]!.error === "no permission",
  );
  expect(
    "one still up > posted (the removed one doesn't count)",
    statusAfterTakeDown(half) === "posted",
  );
  expect("a retry targets only what's still up", takeDownDue(half).length === 1);

  const partial = applyTakeDown(
    [target("facebook", "posted"), target("instagram", "failed"), g],
    outcomes([["facebook", { ok: true }]]),
    now,
  );
  expect(
    "partly posted, then taken down > removed (the failed one was never up)",
    statusAfterTakeDown(partial) === "removed",
  );
  expect(
    "fresh run clears removedAt",
    freshRun(both).every((t) => t.removedAt === null),
  );
}

/** Composer PATCH parsing. */
function checkParse(): void {
  console.log("Parse");
  const ok = parsePostPatch({
    name: "  Spring  ",
    imageUrl: BLOB,
    imageWidth: 1080,
    imageHeight: 1080,
    linkUrl: "",
    targets: [{ platform: "instagram", enabled: false, textOverride: "  " }],
  });
  expect(
    "valid patch parses, blanks clear",
    "patch" in ok &&
      ok.patch.name === "Spring" &&
      ok.patch.linkUrl === null &&
      ok.patch.imageWidth === 1080 &&
      ok.targets?.[0]?.textOverride === null,
    JSON.stringify(ok),
  );
  const blank = parsePostPatch({ name: " " });
  expect(
    "blank name becomes Untitled post",
    "patch" in blank && blank.patch.name === "Untitled post",
  );
  expect(
    "picture from another host is refused",
    "error" in parsePostPatch({ imageUrl: "https://evil.example/a.jpg" }),
  );
  expect(
    "javascript: link is refused",
    "error" in parsePostPatch({ linkUrl: "javascript:alert(1)" }),
  );
  expect("fractional width is refused", "error" in parsePostPatch({ imageWidth: 10.5 }));
  expect(
    "Google can't be switched on yet",
    "error" in parsePostPatch({ targets: [{ platform: "google", enabled: true }] }),
  );
  expect("bad promoId is refused", "error" in parsePostPatch({ promoId: "nope" }));

  const merged = mergeTargets(
    [target("facebook", "posted"), target("instagram", "pending")],
    [{ platform: "instagram", enabled: false }],
  );
  expect(
    "merge changes only the edited fields",
    merged[0]!.enabled &&
      merged[0]!.status === "posted" &&
      !merged[1]!.enabled &&
      merged[1]!.status === "pending",
  );
}

/** The Add menu's contents. */
function checkInsertables(): void {
  console.log("Add menu");
  const details = {
    siteUrl: "https://example.co.nz",
    website: "example.co.nz",
    phone: "021 000 0000",
    email: "me@example.co.nz",
  };
  const items = insertableGroups(details, null).flatMap((g) => g.items);
  const byLabel = new Map(items.map((i) => [i.label, i]));
  expect(
    "booking link uses the site address",
    byLabel.get("Booking page")?.text === "https://example.co.nz/booking",
  );
  expect("phone comes from the details", byLabel.get("Phone number")?.text === "021 000 0000");
  expect("promo items insert placeholders", byLabel.get("Promo summary")?.text === "{promo}");
  expect(
    "no promo running says so",
    byLabel.get("Promo summary")?.hint === "No promo running right now",
  );
  const withPromo = insertableGroups(details, {
    summary: "10% off",
    offer: "10% off labour",
    ends: "31 October",
  });
  expect(
    "a running promo shows its wording as the hint",
    withPromo.flatMap((g) => g.items).find((i) => i.label === "When it ends")?.hint ===
      "31 October",
  );
  expect("labels are unique (they key the menu buttons)", byLabel.size === items.length);
  // Every placeholder the menu offers must be one the validator accepts.
  const placeholders = items.filter((i) => i.text.startsWith("{"));
  expect(
    "offered placeholders pass validation with a promo running",
    placeholders.every((i) => errorsFor(draft({ body: i.text }), "facebook", true).length === 0),
  );
}

/** Runs every group and exits non-zero on any failure. */
function main(): void {
  checkValidators();
  checkFilling();
  checkFromEmail();
  checkJpegSize();
  checkTargets();
  checkTakeDown();
  checkParse();
  checkInsertables();
  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
