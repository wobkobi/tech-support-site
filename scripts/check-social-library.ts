// scripts/check-social-library.ts
// The content library: the starter set's copy and rules, what importing it again does, and the
// library's search, filters, sorts, summary figures and card pictures. Pure logic, no DB.
// Run with: npm test -- social-library

import type { ContentListRow } from "@/features/social/lib/content-row";
import { coverOf } from "@/features/social/lib/cover";
import {
  NO_FILTER,
  filterLibrary,
  foldText,
  isFiltered,
  librarySummary,
  type LibraryFilter,
  type LibrarySort,
} from "@/features/social/lib/library";
import type { SocialPostRow, SocialTargetRow } from "@/features/social/lib/post-row";
import {
  STARTER_CONTENT,
  planStarterImport,
  starterItemFields,
} from "@/features/social/lib/starter-content";
import { hasPhoneNumber, validatePost } from "@/features/social/lib/validate";
import { expect, expectEqual, finish } from "./lib/harness.js";

const LINKS = {
  booking: "https://tothepoint.co.nz/booking",
  about: "https://tothepoint.co.nz/about",
  review: "https://g.page/r/example/review",
};

/** The starter set's shape and copy rules. */
function checkStarterCopy(): void {
  console.log("Starter content");
  expectEqual("16 items", STARTER_CONTENT.length, 16);
  expectEqual(
    "keys are unique",
    new Set(STARTER_CONTENT.map((i) => i.key)).size,
    STARTER_CONTENT.length,
  );
  /**
   * How many items carry a tag.
   * @param tag - Tag name.
   * @returns The count.
   */
  const tagged = (tag: string): number =>
    STARTER_CONTENT.filter((i) => i.tags.includes(tag)).length;
  expectEqual(
    "6 tips, 4 scam warnings, 3 about me, 1 review ask, 2 seasonal",
    [
      tagged("Tech tip"),
      tagged("Scam warning"),
      tagged("About me"),
      tagged("Reviews"),
      tagged("Seasonal"),
    ],
    [6, 4, 3, 1, 2],
  );

  for (const item of STARTER_CONTENT) {
    expect(`${item.key}: 2 or 3 captions`, item.captions.length >= 2 && item.captions.length <= 3);
    const fields = starterItemFields(item, LINKS);
    expectEqual(
      `${item.key}: Facebook and Google on, Instagram off`,
      fields.targets.map((t) => t.enabled),
      [true, false, true],
    );
    item.captions.forEach((text, i) => {
      const label = `${item.key} caption ${i + 1}`;
      const issues = validatePost(
        { ...fields, body: text, imageUrl: null, imageWidth: null, imageHeight: null },
        false,
      );
      expectEqual(`${label}: no Facebook or Google issues`, issues, { facebook: [], google: [] });
      expect(`${label}: no em or en dashes`, !/[–—]/.test(text));
      expect(
        `${label}: first person, never we, our or us`,
        !/\b(we|we're|we've|we'll|our|ours|us)\b/i.test(text),
      );
      expect(`${label}: no phone number`, !hasPhoneNumber(text));
      expect(`${label}: no email address`, !/@/.test(text));
      expect(`${label}: no placeholders`, !/[{}]/.test(text));
      expect(`${label}: no curly quotes`, !/[‘’“”]/.test(text));
    });
  }

  const tip = starterItemFields(STARTER_CONTENT[0]!, LINKS);
  expectEqual(
    "caption 1 is the body, the rest are other captions",
    [tip.body, tip.altCaptions.length],
    [STARTER_CONTENT[0]!.captions[0], STARTER_CONTENT[0]!.captions.length - 1],
  );
  const review = STARTER_CONTENT.find((i) => i.key === "review-ask")!;
  expectEqual(
    "review ask links to the review box",
    starterItemFields(review, LINKS).linkUrl,
    LINKS.review,
  );
  expect(
    "seasonal items post once",
    STARTER_CONTENT.filter((i) => i.tags.includes("Seasonal")).every((i) => !i.recycle),
  );
}

/** What an import adds the first time and after. */
function checkImportPlan(): void {
  console.log("Import");
  const first = planStarterImport(STARTER_CONTENT, new Set(), []);
  expectEqual("empty library: adds every item", first.create.length, 16);
  expectEqual("empty library: makes each tag once", first.newTags, [
    "Tech tip",
    "Scam warning",
    "About me",
    "Reviews",
    "Seasonal",
  ]);

  const again = planStarterImport(
    STARTER_CONTENT,
    new Set(STARTER_CONTENT.map((i) => i.key)),
    first.newTags,
  );
  expectEqual(
    "second import: adds nothing, makes no tags",
    [again.create.length, again.skipped.length, again.newTags],
    [0, 16, []],
  );

  const some = planStarterImport(STARTER_CONTENT, new Set(["tip-updates", "about-me"]), [
    "tech TIP",
    "#Scam warning",
  ]);
  expectEqual("some already there: adds the rest", some.create.length, 14);
  expectEqual("some already there: skips those", some.skipped, ["tip-updates", "about-me"]);
  expectEqual("existing tags are matched whatever the case or a #", some.newTags, [
    "About me",
    "Reviews",
    "Seasonal",
  ]);
}

/**
 * A target with any fields changed.
 * @param platform - The app.
 * @param over - Fields to change.
 * @returns The target row.
 */
function target(
  platform: SocialTargetRow["platform"],
  over: Partial<SocialTargetRow> = {},
): SocialTargetRow {
  return {
    platform,
    enabled: true,
    textOverride: null,
    imageUrl: null,
    imageAlt: null,
    imageWidth: null,
    imageHeight: null,
    imageOriginalUrl: null,
    cropApprovedFor: null,
    status: "pending",
    permalink: null,
    error: null,
    postedAt: null,
    removedAt: null,
    ...over,
  };
}

/**
 * A library row with any item or row fields changed.
 * @param item - Item fields to change.
 * @param over - Row fields to change.
 * @returns The row.
 */
function row(item: Partial<SocialPostRow>, over: Partial<ContentListRow> = {}): ContentListRow {
  return {
    item: {
      id: "6650a1b2c3d4e5f6a7b8c9d0",
      name: "Item",
      body: "",
      imageUrl: null,
      imageAlt: null,
      imageWidth: null,
      imageHeight: null,
      imageOriginalUrl: null,
      linkUrl: null,
      tagIds: [],
      isPreset: false,
      status: "draft",
      scheduledAt: null,
      postedAt: null,
      promoId: null,
      campaignId: null,
      targets: [target("facebook"), target("instagram", { enabled: false }), target("google")],
      googleType: "STANDARD",
      googleCta: null,
      googleUrl: null,
      googleTitle: null,
      offerStart: null,
      offerEnd: null,
      eventStartTime: null,
      eventEndTime: null,
      couponCode: null,
      isContent: true,
      sourceId: null,
      captionIndex: null,
      detached: false,
      altCaptions: [],
      nextCaption: null,
      recycle: false,
      expiresAt: null,
      maxPosts: null,
      updatedAt: "2026-10-01T00:00:00.000Z",
      ...item,
    },
    createdAt: "2026-10-01T00:00:00.000Z",
    stats: { count: 0, lastPostedAt: null, nextAt: null },
    spent: false,
    linedUp: 0,
    queueIds: [],
    ...over,
  };
}

const TIPS = "6650a1b2c3d4e5f6a7b8c9e1";
const SCAMS = "6650a1b2c3d4e5f6a7b8c9e2";
const TAG_NAMES = new Map([
  [TIPS, "Tech tip"],
  [SCAMS, "Scam warning"],
]);

const ROWS: ContentListRow[] = [
  row(
    {
      id: "a",
      name: "Māori Language Week",
      body: "Kia ora",
      recycle: true,
      tagIds: [TIPS],
      imageUrl: "https://x.public.blob.vercel-storage.com/a.jpg",
    },
    {
      createdAt: "2026-10-03T00:00:00.000Z",
      stats: { count: 4, lastPostedAt: "2026-10-10T00:00:00.000Z", nextAt: null },
      queueIds: ["q1"],
    },
  ),
  row(
    {
      id: "b",
      name: "Bank calls",
      body: "Hang up",
      altCaptions: ["Ring the number on your card"],
      tagIds: [SCAMS],
      targets: [
        target("facebook", { enabled: false }),
        target("instagram", { imageUrl: "https://x.public.blob.vercel-storage.com/b.jpg" }),
        target("google"),
      ],
    },
    {
      createdAt: "2026-10-01T00:00:00.000Z",
      stats: { count: 1, lastPostedAt: "2026-09-01T00:00:00.000Z", nextAt: null },
      spent: true,
    },
  ),
  row(
    { id: "c", name: "Updates", body: "Say yes", recycle: true, tagIds: [TIPS, SCAMS] },
    { createdAt: "2026-10-02T00:00:00.000Z", queueIds: ["q1", "q2"] },
  ),
];

/**
 * The ids a filter and sort show.
 * @param change - Filter parts to change.
 * @param sort - The order.
 * @returns Ids in order.
 */
function ids(change: Partial<LibraryFilter>, sort: LibrarySort = "az"): string[] {
  return filterLibrary(ROWS, { ...NO_FILTER, ...change }, sort, TAG_NAMES).map((r) => r.item.id);
}

/** The library's search, filters and sorts. */
function checkFilters(): void {
  console.log("Library");
  expectEqual("foldText: macrons and case", foldText("Māori ÉCOLE"), "maori ecole");
  expectEqual("no filter: everything, A-Z", ids({}), ["b", "a", "c"]);
  expect("no filter isn't filtered", !isFiltered(NO_FILTER));
  expect("a space-only search isn't filtered", !isFiltered({ ...NO_FILTER, search: "  " }));

  expectEqual("search ignores macrons", ids({ search: "maori" }), ["a"]);
  expectEqual("search reads other captions", ids({ search: "your card" }), ["b"]);
  expectEqual("search reads tag names", ids({ search: "scam" }), ["b", "c"]);
  expectEqual("every word must match", ids({ search: "say scam" }), ["c"]);
  expectEqual("no match", ids({ search: "printer" }), []);

  expectEqual("any of the tags", ids({ tagIds: [TIPS] }), ["a", "c"]);
  expectEqual("two tags: either", ids({ tagIds: [TIPS, SCAMS] }), ["b", "a", "c"]);
  expectEqual("has a picture, its own or an app's", ids({ picture: "with" }), ["b", "a"]);
  expectEqual("no picture", ids({ picture: "without" }), ["c"]);
  expectEqual("recycling on", ids({ recycling: "on" }), ["a", "c"]);
  expectEqual("recycling off", ids({ recycling: "off" }), ["b"]);
  expectEqual("finished", ids({ state: "finished" }), ["b"]);
  expectEqual("can still go out", ids({ state: "active" }), ["a", "c"]);
  expectEqual("on Facebook", ids({ platform: "facebook" }), ["a", "c"]);
  expectEqual("on Instagram", ids({ platform: "instagram" }), ["b"]);
  expectEqual("in a schedule", ids({ schedule: "in" }), ["a", "c"]);
  expectEqual("in no schedule", ids({ schedule: "none" }), ["b"]);
  expectEqual("in one schedule", ids({ schedule: "q2" }), ["c"]);
  expect("a schedule filter is filtered", isFiltered({ ...NO_FILTER, schedule: "q1" }));

  expectEqual("newest first", ids({}, "newest"), ["a", "c", "b"]);
  expectEqual("oldest first", ids({}, "oldest"), ["b", "c", "a"]);
  expectEqual("most postings", ids({}, "most"), ["a", "b", "c"]);
  expectEqual("longest since posted: never posted first", ids({}, "longest"), ["c", "b", "a"]);
}

/** The figures across the top and the card pictures. */
function checkSummaryAndCover(): void {
  console.log("Summary");
  const now = new Date("2026-10-22T00:00:00.000Z"); // 22 Oct in NZ
  const rows = [
    row({ recycle: true, expiresAt: "2026-10-22" }),
    row({ recycle: true, expiresAt: "2026-11-05" }),
    row({ expiresAt: "2026-11-06" }),
    row({ recycle: true, expiresAt: "2026-10-25" }, { spent: true }),
    row({ expiresAt: "2026-10-21" }),
  ];
  expectEqual("figures", librarySummary(rows, 7, now), {
    items: 5,
    recycling: 2,
    postedThisMonth: 7,
    endingSoon: 2,
  });

  console.log("Cover");
  const own = row({
    imageUrl: "https://x/own.jpg",
    imageAlt: "Own",
    targets: [target("facebook", { imageUrl: "https://x/fb.jpg" })],
  }).item;
  expectEqual("the post's own picture first", coverOf(own)?.url, "https://x/own.jpg");
  const appOnly = row({
    targets: [
      target("facebook", { enabled: false, imageUrl: "https://x/off.jpg" }),
      target("instagram", { imageUrl: "https://x/ig.jpg", imageWidth: 1080, imageHeight: 1350 }),
    ],
  }).item;
  expectEqual("else the first app it's on with a picture", coverOf(appOnly), {
    url: "https://x/ig.jpg",
    alt: "",
    width: 1080,
    height: 1350,
  });
  expectEqual("no picture anywhere", coverOf(row({}).item), null);
}

/** Runs every check. */
function main(): void {
  checkStarterCopy();
  checkImportPlan();
  checkFilters();
  checkSummaryAndCover();
  finish();
}

main();
