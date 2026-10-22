// scripts/check-social-content.ts
// Content items and postings: captions in turn, what a posting copies from its item, when an item
// has run its course, and the content fields of an edit. Pure logic, no DB.
// Run with: npm test -- social-content

import { hasContentFields, parseContentPatch } from "@/features/social/lib/parse";
import {
  MAX_CAPTIONS,
  captionAfter,
  captionsOf,
  clampCaption,
  isSpent,
  postingContent,
  postingFields,
  spentReason,
} from "@/features/social/lib/postings-core";
import { defaultTargets } from "@/features/social/lib/targets";
import type { SocialPost } from "@prisma/client";
import { expect, expectEqual, finish } from "./lib/harness.js";

const BLOB = "https://abc.public.blob.vercel-storage.com/social/image-x1.jpg";

/**
 * A content item with three captions and Facebook's own words, with any fields overridden.
 * @param over - Fields to change.
 * @returns The item as stored.
 */
function item(over: Partial<SocialPost> = {}): SocialPost {
  const targets = defaultTargets().map((t) =>
    t.platform === "facebook"
      ? { ...t, textOverride: "Facebook's own words", status: "posted" as const, externalId: "x1" }
      : t.platform === "google"
        ? { ...t, enabled: false }
        : t,
  );
  return {
    id: "6650a1b2c3d4e5f6a7b8c9d0",
    name: "Backup reminder",
    body: "Caption one",
    imageUrl: BLOB,
    imageAlt: "A laptop",
    imageWidth: 1080,
    imageHeight: 1350,
    imageOriginalUrl: null,
    linkUrl: "https://tothepoint.co.nz/booking",
    tagIds: ["6650a1b2c3d4e5f6a7b8c9d1"],
    isPreset: false,
    presetKey: null,
    status: "draft",
    scheduledAt: null,
    postedAt: null,
    postingStartedAt: null,
    promoId: null,
    campaignId: "6650a1b2c3d4e5f6a7b8c9d2",
    emailSkipped: true,
    isContent: true,
    sourceId: null,
    captionIndex: null,
    detached: null,
    altCaptions: ["Caption two", "Caption three"],
    nextCaption: 1,
    recycle: true,
    expiresAt: null,
    maxPosts: null,
    starterKey: null,
    targets,
    googleType: "STANDARD",
    googleCta: null,
    googleUrl: null,
    googleTitle: null,
    offerStart: null,
    offerEnd: null,
    eventStartTime: null,
    eventEndTime: null,
    couponCode: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-02T00:00:00.000Z"),
    ...over,
  };
}

/** Captions in order, and which one goes next. */
function checkCaptions(): void {
  console.log("Captions");
  expectEqual("captionsOf: body first", captionsOf(item()), [
    "Caption one",
    "Caption two",
    "Caption three",
  ]);
  expectEqual("captionsOf: no others", captionsOf({ body: "Only" }), ["Only"]);

  const list = ["One", "", "Three"];
  expectEqual("clampCaption: in range", clampCaption(list, 2), 2);
  expectEqual("clampCaption: skips a blank one", clampCaption(list, 1), 2);
  expectEqual("clampCaption: null starts at caption 1", clampCaption(list, null), 0);
  expectEqual("clampCaption: past the end starts at caption 1", clampCaption(list, 7), 0);
  expectEqual("clampCaption: negative starts at caption 1", clampCaption(list, -1), 0);
  expectEqual("clampCaption: not a whole number starts at caption 1", clampCaption(list, 1.5), 0);
  expectEqual("clampCaption: goes round past blanks", clampCaption(["", "Two", ""], 2), 1);
  expectEqual("clampCaption: every caption blank", clampCaption(["", " "], 1), 0);

  expectEqual("captionAfter: next one", captionAfter(list, 0), 1);
  expectEqual("captionAfter: goes round", captionAfter(list, 2), 0);
  expectEqual(
    "captionAfter: rotation lands on a filled caption",
    clampCaption(list, captionAfter(list, 0)),
    2,
  );
  expectEqual("captionAfter: one caption", captionAfter(["Only"], 0), 0);
}

/** What a posting takes from its item. */
function checkPostingFields(): void {
  console.log("Postings");
  const source = item();

  const first = postingContent(source, 0);
  expectEqual("caption 1: body", first.body, "Caption one");
  expectEqual(
    "caption 1: keeps Facebook's own words",
    first.targets[0]?.textOverride,
    "Facebook's own words",
  );
  expectEqual("caption 1: captionIndex", first.captionIndex, 0);

  const third = postingContent(source, 2);
  expectEqual("caption 3: body", third.body, "Caption three");
  expectEqual(
    "caption 3: drops each app's own words",
    third.targets.map((t) => t.textOverride),
    [null, null, null],
  );
  expectEqual(
    "missing caption falls back to the body",
    postingContent(source, 9).body,
    "Caption one",
  );

  expectEqual(
    "targets start fresh",
    first.targets.map((t) => [t.status, t.externalId, t.postedAt]),
    [
      ["pending", null, null],
      ["pending", null, null],
      ["pending", null, null],
    ],
  );
  expectEqual(
    "the item's on/off carries over",
    first.targets.map((t) => t.enabled),
    [true, true, false],
  );

  const some = postingContent(source, 0, ["instagram", "google"]);
  expectEqual(
    "platforms: only those asked for, and the item's off still wins",
    some.targets.map((t) => t.enabled),
    [false, true, false],
  );
  expectEqual(
    "picture, link and alt copy over",
    [some.imageUrl, some.imageAlt, some.linkUrl],
    [BLOB, "A laptop", "https://tothepoint.co.nz/booking"],
  );

  const at = new Date("2026-11-03T20:00:00.000Z");
  const scheduled = postingFields(source, { captionIndex: 1, scheduledAt: at });
  expectEqual(
    "scheduled: status and time",
    [scheduled.status, scheduled.scheduledAt],
    ["scheduled", at],
  );
  expectEqual("links back to the item", scheduled.sourceId, source.id);
  expectEqual("tags copy over", scheduled.tagIds, source.tagIds);
  const now = postingFields(source, { captionIndex: 0, scheduledAt: null });
  expectEqual("posted now: starts as a draft", [now.status, now.scheduledAt], ["draft", null]);
  for (const key of [
    "campaignId",
    "emailSkipped",
    "isContent",
    "altCaptions",
    "recycle",
    "nextCaption",
  ]) {
    expect(`the item's own ${key} stays on the item`, !(key in now));
  }
}

/** When an item has run its course. */
function checkSpent(): void {
  console.log("Spent");
  // Last day 22 October: NZDT is UTC+13, so 22 Oct ends at 10:59:59 UTC.
  const lastDay = { expiresAt: new Date("2026-10-22T00:00:00.000Z"), maxPosts: null };
  const none = { count: 0, lastPostedAt: null, nextAt: null };
  expect(
    "before the last day ends: can go",
    !isSpent(lastDay, none, new Date("2026-10-22T10:30:00.000Z")),
  );
  expect(
    "after the last day in NZ: spent",
    isSpent(lastDay, none, new Date("2026-10-22T11:30:00.000Z")),
  );
  expect(
    "past the last day: says to change it",
    spentReason(lastDay, none, new Date("2026-10-23T11:30:00.000Z"))?.includes(
      "Change Last day",
    ) === true,
  );

  const limit = { expiresAt: null, maxPosts: 3 };
  const at = new Date("2026-10-22T00:00:00.000Z");
  expect("under the limit: can go", !isSpent(limit, { ...none, count: 2 }, at));
  expect("at the limit: spent", isSpent(limit, { ...none, count: 3 }, at));
  expect(
    "at the limit: says how many",
    spentReason(limit, { ...none, count: 3 }, at)?.startsWith("It has 3 postings") === true,
  );
  expect(
    "a limit of one reads as 1 posting",
    spentReason({ expiresAt: null, maxPosts: 1 }, { ...none, count: 1 }, at)?.startsWith(
      "It has 1 posting,",
    ) === true,
  );
  expect(
    "no limits: never spent",
    !isSpent({ expiresAt: null, maxPosts: null }, { ...none, count: 500 }, at),
  );
}

/** The content fields of an edit. */
function checkParse(): void {
  console.log("Parse");
  expectEqual(
    "captions, recycling, last day and limit",
    parseContentPatch({
      altCaptions: ["Two", ""],
      recycle: true,
      expiresAt: "2026-12-24",
      maxPosts: 5,
    }),
    {
      patch: {
        altCaptions: ["Two", ""],
        recycle: true,
        expiresAt: new Date("2026-12-24T00:00:00.000Z"),
        maxPosts: 5,
      },
    },
  );
  expectEqual("nothing to change", parseContentPatch({ body: "Words" }), { patch: {} });
  expectEqual(
    "clearing the last day and limit",
    parseContentPatch({ expiresAt: "", maxPosts: null }),
    {
      patch: { expiresAt: null, maxPosts: null },
    },
  );

  /**
   * The error a body gets, or null.
   * @param raw - Request JSON.
   * @returns Its error message.
   */
  const errorOf = (raw: unknown): string | null => {
    const out = parseContentPatch(raw);
    return "error" in out ? out.error : null;
  };
  expect("too many captions", errorOf({ altCaptions: Array(MAX_CAPTIONS).fill("x") }) !== null);
  expect("the most captions", errorOf({ altCaptions: Array(MAX_CAPTIONS - 1).fill("x") }) === null);
  expect("captions that aren't text", errorOf({ altCaptions: ["x", 3] }) !== null);
  expect("captions not in a list", errorOf({ altCaptions: "x" }) !== null);
  expect("a caption too long", errorOf({ altCaptions: ["x".repeat(70_000)] }) !== null);
  expect("recycle not true or false", errorOf({ recycle: "yes" }) !== null);
  expect("a last day that isn't real", errorOf({ expiresAt: "2026-02-30" }) !== null);
  expect("a last day that isn't a date", errorOf({ expiresAt: "soon" }) !== null);
  expect("a limit of nought", errorOf({ maxPosts: 0 }) !== null);
  expect("a limit over the most", errorOf({ maxPosts: 1000 }) !== null);
  expect("a limit that isn't whole", errorOf({ maxPosts: 2.5 }) !== null);
  expect("not an object", errorOf(null) !== null);

  expect("hasContentFields: recycle off still counts", hasContentFields({ recycle: false }));
  expect("hasContentFields: a null limit counts", hasContentFields({ maxPosts: null }));
  expect("hasContentFields: an ordinary edit", !hasContentFields({ body: "x", tagIds: [] }));
  expect("hasContentFields: not an object", !hasContentFields("x"));
}

/** Runs every check. */
function main(): void {
  checkCaptions();
  checkPostingFields();
  checkSpent();
  checkParse();
  finish();
}

main();
