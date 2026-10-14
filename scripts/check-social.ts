// scripts/check-social.ts
// Social posting logic that has to be right before anything goes public: each
// platform's validator, the Google post body, promo placeholder filling, turning an email into a post, the
// JPEG size reader, how per-platform outcomes roll up into the post status, how a
// take-down is recorded, and the composer's PATCH parsing. Pure logic, no database
// and no network.
// Run with: npm test -- social

import { postFromEmail } from "@/features/social/lib/from-email";
import { googlePostBody } from "@/features/social/lib/google-post";
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
  cropOf,
  fillPromo,
  pictureFor,
  shownRatio,
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
function errorsFor(
  post: PostDraft,
  platform: "facebook" | "instagram" | "google",
  hasPromo = true,
): string[] {
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

/**
 * A post going to Google only, with any fields overridden.
 * @param over - Fields to change.
 * @returns The draft.
 */
function googleDraft(over: Partial<PostDraft> = {}): PostDraft {
  return draft({
    imageWidth: 1200,
    imageHeight: 900,
    targets: [{ platform: "google", enabled: true, textOverride: null }],
    ...over,
  });
}

/**
 * A full Google offer, with any fields overridden.
 * @param over - Fields to change.
 * @returns The draft.
 */
function offerDraft(over: Partial<PostDraft> = {}): PostDraft {
  return googleDraft({
    googleType: "OFFER",
    googleTitle: "Spring special",
    offerStart: "2026-10-14",
    offerEnd: new Date("2026-10-31T00:00:00.000Z"),
    ...over,
  });
}

/** Google rules and the localPosts body. */
function checkGoogle(): void {
  console.log("Google");
  expect("google: a plain update passes", errorsFor(googleDraft(), "google").length === 0);
  expect(
    "google: empty text blocks",
    errorsFor(googleDraft({ body: " " }), "google").includes("Google needs some text."),
  );
  expect(
    "google: over 1,500 characters blocks",
    errorsFor(googleDraft({ body: "a".repeat(1_501) }), "google").some((m) => m.includes("1,500")),
  );
  for (const phone of ["021 123 4567", "(09) 555-1234", "+64 21 123 4567", "0800 123 456"]) {
    expect(
      `google: phone "${phone}" blocks`,
      errorsFor(googleDraft({ body: `Call ${phone} today` }), "google").some((m) =>
        m.includes("phone numbers"),
      ),
    );
  }
  for (const fine of [
    "Open 10.00-17.00",
    "Book by 14/10/2026",
    "Sessions from $120",
    "Since 2019",
  ]) {
    expect(
      `google: "${fine}" isn't a phone number`,
      errorsFor(googleDraft({ body: fine }), "google").length === 0,
    );
  }
  expect(
    "google: an email address blocks",
    errorsFor(googleDraft({ body: "Email help@example.co.nz" }), "google").some((m) =>
      m.includes("email addresses"),
    ),
  );
  expect(
    "google: Book without a link blocks",
    errorsFor(googleDraft({ googleCta: "BOOK" }), "google").some((m) => m.includes("needs a link")),
  );
  expect(
    "google: Call needs no link",
    errorsFor(googleDraft({ googleCta: "CALL" }), "google").length === 0,
  );
  const linkNoButton = validatePost(googleDraft({ linkUrl: "https://example.co.nz" }), true);
  expect(
    "google: a link without a button warns but doesn't block",
    (linkNoButton.google ?? []).some((i) => i.level === "warning") &&
      !(linkNoButton.google ?? []).some((i) => i.level === "error"),
  );
  expect("google: a full offer passes", errorsFor(offerDraft(), "google").length === 0);
  expect(
    "google: an offer without a title blocks",
    errorsFor(offerDraft({ googleTitle: " " }), "google").includes("A Google offer needs a title."),
  );
  expect(
    "google: an offer without an end date blocks",
    errorsFor(offerDraft({ offerEnd: null }), "google").some((m) => m.includes("start and an end")),
  );
  expect(
    "google: an offer ending before it starts blocks",
    errorsFor(offerDraft({ offerStart: "2026-11-01" }), "google").some((m) =>
      m.includes("ends before it starts"),
    ),
  );
  expect(
    "google: an offer's link is the redeem link, not a warning",
    (validatePost(offerDraft({ linkUrl: "https://example.co.nz" }), true).google ?? []).length ===
      0,
  );

  const base = {
    text: "Hello",
    imageUrl: BLOB,
    imageAlt: null,
    linkUrl: "https://example.co.nz/booking",
  };
  const noGoogle = { title: null, start: null, end: null, couponCode: null };
  const update = googlePostBody({
    ...base,
    google: { type: "STANDARD", cta: "BOOK", ...noGoogle },
  });
  expect(
    "body: update sends the picture and a Book button with the link",
    update.topicType === "STANDARD" &&
      update.media?.[0]?.sourceUrl === BLOB &&
      update.callToAction?.actionType === "BOOK" &&
      update.callToAction.url === base.linkUrl &&
      update.event === undefined,
  );
  const call = googlePostBody({ ...base, google: { type: "STANDARD", cta: "CALL", ...noGoogle } });
  expect(
    "body: Call sends no URL",
    call.callToAction?.actionType === "CALL" && call.callToAction.url === undefined,
  );
  const plain = googlePostBody({ ...base, google: { type: "STANDARD", cta: null, ...noGoogle } });
  expect("body: no button sends no callToAction", plain.callToAction === undefined);
  const offerBody = googlePostBody({
    ...base,
    google: {
      type: "OFFER",
      cta: "BOOK",
      title: "Spring special",
      start: "2026-10-14",
      end: "2026-10-31",
      couponCode: "SPRING",
    },
  });
  expect(
    "body: offer sends whole-day dates, coupon and redeem link, and no button",
    offerBody.topicType === "OFFER" &&
      offerBody.callToAction === undefined &&
      offerBody.event?.title === "Spring special" &&
      JSON.stringify(offerBody.event.schedule) ===
        JSON.stringify({
          startDate: { year: 2026, month: 10, day: 14 },
          startTime: { hours: 0, minutes: 0 },
          endDate: { year: 2026, month: 10, day: 31 },
          endTime: { hours: 23, minutes: 59 },
        }) &&
      offerBody.offer?.couponCode === "SPRING" &&
      offerBody.offer.redeemOnlineUrl === base.linkUrl,
  );
}

/** Which edges each platform cuts, the OK, and per-platform pictures. */
function checkPictures(): void {
  console.log("Pictures");
  const OWN = "https://abc.public.blob.vercel-storage.com/social/google-x1.jpg";
  expect("crop: 4:3 fits Google", cropOf("google", 1200, 900) === null);
  expect("crop: 1200 x 899 still fits Google", cropOf("google", 1200, 899) === null);
  expect(
    "crop: a square loses Google its top and bottom",
    cropOf("google", 1080, 1080) === "top and bottom",
  );
  expect("crop: 16:9 loses Google its sides", cropOf("google", 1600, 900) === "sides");
  expect("crop: a square fits Facebook", cropOf("facebook", 1080, 1080) === null);
  expect(
    "crop: 9:16 loses Facebook its top and bottom",
    cropOf("facebook", 675, 1200) === "top and bottom",
  );
  expect("crop: 3:1 loses Facebook its sides", cropOf("facebook", 1500, 500) === "sides");
  expect("shown: Facebook draws 9:16 at 4:5", shownRatio("facebook", 675, 1200) === 4 / 5);
  expect("shown: Google draws an unknown size at 4:3", shownRatio("google", null, null) === 4 / 3);

  /**
   * A post with a square picture.
   * @param targets - The post's targets.
   * @returns The draft.
   */
  const square = (targets: PostDraft["targets"]): PostDraft => draft({ targets });
  expect(
    "google: a square picture blocks until OK'd",
    errorsFor(square([{ platform: "google", enabled: true, textOverride: null }]), "google").some(
      (m) => m.includes("cut off the picture's top and bottom"),
    ),
  );
  const okd =
    validatePost(
      square([{ platform: "google", enabled: true, textOverride: null, cropApprovedFor: BLOB }]),
      true,
    ).google ?? [];
  expect(
    "google: OK'ing the cut turns it into a note",
    !okd.some((i) => i.level === "error") && okd.some((i) => i.message.includes("You've OK'd")),
  );
  expect(
    "google: an OK for a different picture doesn't count",
    errorsFor(
      square([{ platform: "google", enabled: true, textOverride: null, cropApprovedFor: OWN }]),
      "google",
    ).some((m) => m.includes("cut off")),
  );
  const ownPicture = square([
    {
      platform: "google",
      enabled: true,
      textOverride: null,
      imageUrl: OWN,
      imageWidth: 1200,
      imageHeight: 900,
    },
  ]);
  expect("google: its own 4:3 picture passes", errorsFor(ownPicture, "google").length === 0);
  expect("pictureFor: own picture wins", pictureFor(ownPicture, "google")?.url === OWN);
  expect("pictureFor: others get the post's", pictureFor(ownPicture, "facebook")?.url === BLOB);
  expect(
    "facebook: 9:16 blocks until OK'd",
    errorsFor(draft({ imageWidth: 675, imageHeight: 1200 }), "facebook").some((m) =>
      m.includes("cut off"),
    ),
  );
  expect(
    "facebook: unknown size blocks",
    errorsFor(draft({ imageWidth: null }), "facebook").some((m) => m.includes("size is unknown")),
  );
  expect(
    "instagram: an OK can't get a 9:16 picture through",
    errorsFor(
      draft({
        imageWidth: 675,
        imageHeight: 1200,
        targets: [
          { platform: "instagram", enabled: true, textOverride: null, cropApprovedFor: BLOB },
        ],
      }),
      "instagram",
    ).some((m) => m.includes("4:5")),
  );
  expect(
    "instagram: its own picture gets a 9:16 post through",
    errorsFor(
      draft({
        imageWidth: 675,
        imageHeight: 1200,
        targets: [
          {
            platform: "instagram",
            enabled: true,
            textOverride: null,
            imageUrl: OWN,
            imageWidth: 1080,
            imageHeight: 1350,
          },
        ],
      }),
      "instagram",
    ).length === 0,
  );

  const parsed = parsePostPatch({
    targets: [
      {
        platform: "google",
        imageUrl: OWN,
        imageAlt: "Laptop on a desk",
        imageWidth: 1200,
        imageHeight: 900,
        cropApprovedFor: BLOB,
      },
    ],
  });
  expect(
    "parse: own picture and OK come through",
    !("error" in parsed) &&
      parsed.targets?.[0]?.imageUrl === OWN &&
      parsed.targets[0].imageWidth === 1200 &&
      parsed.targets[0].cropApprovedFor === BLOB,
  );
  expect(
    "parse: own picture from another host is refused",
    "error" in
      parsePostPatch({ targets: [{ platform: "google", imageUrl: "https://evil.example/x.jpg" }] }),
  );
  const merged = mergeTargets(
    [target("google", "pending")],
    [{ platform: "google", imageUrl: OWN, cropApprovedFor: null }],
  );
  expect(
    "merge: own picture lands, untouched fields stay",
    merged[0]!.imageUrl === OWN && merged[0]!.enabled && merged[0]!.cropApprovedFor === null,
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

  const blocks = postFromEmail(
    [
      "Hi {firstName},",
      "",
      "::promo",
      "",
      "---",
      "",
      "> ★★★★★",
      "> Sorted my printer in no time.",
      "> - Pat, Avondale",
      "",
      "::space",
      "::social",
      "::mystery",
      "",
      '[![Shop front](https://abc.public.blob.vercel-storage.com/mailing/c.jpg "small")](https://tothepoint.co.nz)',
    ].join("\n"),
  );
  expect(
    "promo card becomes {promo}; divider, spacer, social and unknown blocks drop; quote loses its markers",
    blocks.body === "{promo}\n\n★★★★★\nSorted my printer in no time.\n- Pat, Avondale",
    JSON.stringify(blocks.body),
  );
  expect(
    "a linked, small picture still becomes the image",
    blocks.imageUrl === "https://abc.public.blob.vercel-storage.com/mailing/c.jpg" &&
      blocks.imageAlt === "Shop front",
    JSON.stringify(blocks),
  );
  const ownReview = postFromEmail("> ★★★★★\n> {reviewText}\n\nThanks!");
  expect(
    "a quote of the recipient's own review is dropped whole",
    ownReview.body === "Thanks!",
    JSON.stringify(ownReview.body),
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
    imageUrl: null,
    imageAlt: null,
    imageWidth: null,
    imageHeight: null,
    cropApprovedFor: null,
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
    "defaults: every platform on",
    defaults.map((t) => `${t.platform}:${t.enabled}`).join(",") ===
      "facebook:true,instagram:true,google:true",
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
    "Google can be switched on",
    !("error" in parsePostPatch({ targets: [{ platform: "google", enabled: true }] })),
  );
  const offer = parsePostPatch({
    googleType: "OFFER",
    googleCta: null,
    googleTitle: "  Spring special  ",
    offerStart: "2026-10-14",
    offerEnd: "",
  });
  expect(
    "Google offer fields parse, a blank date clears",
    !("error" in offer) &&
      offer.patch.googleType === "OFFER" &&
      offer.patch.googleCta === null &&
      offer.patch.googleTitle === "Spring special" &&
      offer.patch.offerStart?.toISOString() === "2026-10-14T00:00:00.000Z" &&
      offer.patch.offerEnd === null,
  );
  expect("unknown Google type is refused", "error" in parsePostPatch({ googleType: "ALERT" }));
  expect("unknown Google button is refused", "error" in parsePostPatch({ googleCta: "SHOP" }));
  expect("31 February is refused", "error" in parsePostPatch({ offerEnd: "2026-02-31" }));
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
  checkGoogle();
  checkPictures();
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
