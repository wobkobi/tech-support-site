// scripts/check-social-media.ts
// Post kinds and media: which apps take each kind, the reel, story, cover and several-picture
// rules, the Instagram and Facebook parameters each kind sends, when a run waiting on a video is
// due a check, the card picture, media edits, and how a photo sits in a story. Pure logic, no DB.
// Run with: npm test -- social-media

import type { PublishInput } from "@/features/social/lib/adapter";
import { coverOf } from "@/features/social/lib/cover";
import { albumParams, facebookCaption, reelFinishParams } from "@/features/social/lib/facebook";
import { instagramContainers } from "@/features/social/lib/instagram";
import {
  CONTAINER_TTL_MS,
  canTakeDown,
  containerExpired,
  formatOf,
  formatTakes,
  isVideoFile,
  mediaUrlsOf,
  resumeDue,
  usesText,
} from "@/features/social/lib/media";
import { parsePostPatch } from "@/features/social/lib/parse";
import { placeIn } from "@/features/social/lib/story-picture";
import { defaultTargets } from "@/features/social/lib/targets";
import {
  validatePost,
  type DraftMedia,
  type Issue,
  type PostDraft,
} from "@/features/social/lib/validate";
import { expect, expectEqual, finish } from "./lib/harness.js";

const HOST = "https://abc.public.blob.vercel-storage.com";
const JPEG = `${HOST}/social/image-a1.jpg`;
const PNG = `${HOST}/social/image-a2.png`;
const VIDEO = `${HOST}/social/video/video-b1.mp4`;
const FRAME = `${HOST}/social/video/cover-frame-b2.jpg`;

/**
 * A post on the given apps with one square JPEG, with any fields overridden.
 * @param apps - Apps switched on.
 * @param over - Fields to change.
 * @returns The draft the rules read.
 */
function draft(apps: string[], over: Partial<PostDraft> = {}): PostDraft {
  return {
    body: "Back up your phone before you update it.",
    imageUrl: JPEG,
    imageWidth: 1080,
    imageHeight: 1080,
    linkUrl: null,
    targets: defaultTargets().map((t) => ({ ...t, enabled: apps.includes(t.platform) })),
    ...over,
  };
}

/**
 * A 9:16 video, with any fields overridden.
 * @param over - Fields to change.
 * @returns The video as the rules read it.
 */
function video(over: Partial<DraftMedia> = {}): DraftMedia {
  return {
    url: VIDEO,
    width: 1080,
    height: 1920,
    durationMs: 12_000,
    sizeBytes: 8_000_000,
    ...over,
  };
}

/**
 * One app's messages.
 * @param issues - Output of validatePost.
 * @param app - The app.
 * @returns Its messages, errors and warnings alike.
 */
function messages(issues: Partial<Record<string, Issue[]>>, app: string): string[] {
  return (issues[app] ?? []).map((i) => `${i.level}: ${i.message}`);
}

/**
 * Whether any message for an app contains some words.
 * @param issues - Output of validatePost.
 * @param app - The app.
 * @param words - Words to look for.
 * @param level - Only messages at this level.
 * @returns True when one matches.
 */
function has(
  issues: Partial<Record<string, Issue[]>>,
  app: string,
  words: string,
  level?: Issue["level"],
): boolean {
  return (issues[app] ?? []).some(
    (i) => i.message.includes(words) && (level === undefined || i.level === level),
  );
}

/**
 * A publish input for one app, with any fields overridden.
 * @param over - Fields to change.
 * @returns The adapter input.
 */
function input(over: Partial<PublishInput> = {}): PublishInput {
  return {
    format: "feed",
    text: "Caption",
    imageUrl: JPEG,
    imageAlt: null,
    images: [{ url: JPEG, alt: null }],
    video: null,
    linkUrl: null,
    google: {
      type: "STANDARD",
      cta: null,
      url: null,
      title: null,
      start: null,
      end: null,
      startTime: null,
      endTime: null,
      couponCode: null,
    },
    containerId: null,
    containerCreatedAt: null,
    ...over,
  };
}

console.log("\nKinds of post");
expectEqual("null is an ordinary post", formatOf(null), "feed");
expectEqual("a stored reel", formatOf("reel"), "reel");
expectEqual("an unknown kind is an ordinary post", formatOf("carousel"), "feed");
expect("Google takes ordinary posts", formatTakes("feed", "google"));
expect("Google doesn't take reels", !formatTakes("reel", "google"));
expect("Google doesn't take stories", !formatTakes("story", "google"));
expect("only Facebook takes a cover", formatTakes("cover", "facebook"));
expect("Instagram has no cover", !formatTakes("cover", "instagram"));
expectEqual(
  "take-downs: posts and reels only",
  (["feed", "reel", "story", "cover"] as const).map(canTakeDown),
  [true, true, false, false],
);
expectEqual(
  "words: posts and reels only",
  (["feed", "reel", "story", "cover"] as const).map(usesText),
  [true, true, false, false],
);
expect("an uploaded video is a video file", isVideoFile(VIDEO));
expect("its cover frame sits with the videos", isVideoFile(FRAME));
expect("a picture isn't", !isVideoFile(JPEG));
expectEqual(
  "every stored file a post points at",
  mediaUrlsOf({
    imageUrl: JPEG,
    imageOriginalUrl: `${HOST}/social/image-o.jpg`,
    targets: [
      { imageUrl: null },
      { imageUrl: PNG, imageOriginalUrl: `${HOST}/social/image-p.png` },
    ],
    moreImages: [{ url: `${HOST}/social/image-c.jpg` }],
    video: { url: VIDEO, coverUrl: FRAME },
  }),
  [
    JPEG,
    `${HOST}/social/image-o.jpg`,
    null,
    null,
    PNG,
    `${HOST}/social/image-p.png`,
    `${HOST}/social/image-c.jpg`,
    VIDEO,
    FRAME,
  ],
);

console.log("\nApps that don't take the kind");
{
  const issues = validatePost(
    draft(["facebook", "google"], { format: "reel", video: video() }),
    false,
  );
  expect(
    "a reel on Google is an error of its own",
    has(issues, "google", "Google doesn't take reels", "error"),
    messages(issues, "google").join(" | "),
  );
  expectEqual("and nothing else for Google", (issues.google ?? []).length, 1);
}

console.log("\nReels");
{
  const none = validatePost(draft(["instagram"], { format: "reel" }), false);
  expect("a reel needs a video", has(none, "instagram", "A reel needs a video", "error"));

  const fine = validatePost(
    draft(["facebook", "instagram"], { format: "reel", video: video() }),
    false,
  );
  expectEqual("a 12-second 9:16 MP4 is fine on Facebook", messages(fine, "facebook"), []);
  expectEqual("and on Instagram", messages(fine, "instagram"), []);

  const short = validatePost(
    draft(["instagram"], { format: "reel", video: video({ durationMs: 2_000 }) }),
    false,
  );
  expect("under 3 seconds is refused", has(short, "instagram", "at least 3 seconds", "error"));
  const long = validatePost(
    draft(["instagram"], { format: "reel", video: video({ durationMs: 95_000 }) }),
    false,
  );
  expect("over 90 seconds is refused", has(long, "instagram", "up to 90 seconds", "error"));
  const unknown = validatePost(
    draft(["instagram"], { format: "reel", video: video({ durationMs: null }) }),
    false,
  );
  expect(
    "an unknown length asks for the upload again",
    has(unknown, "instagram", "length is unknown", "error"),
  );
  const wide = validatePost(
    draft(["facebook"], { format: "reel", video: video({ width: 1920, height: 1080 }) }),
    false,
  );
  expect("landscape only warns", has(wide, "facebook", "9:16 portrait", "warning"));
  expect("and blocks nothing", !(wide.facebook ?? []).some((i) => i.level === "error"));
  const avi = validatePost(
    draft(["facebook"], { format: "reel", video: video({ url: `${HOST}/social/video/clip.avi` }) }),
    false,
  );
  expect("only MP4 or MOV", has(avi, "facebook", "MP4 or MOV", "error"));
  const big = validatePost(
    draft(["facebook"], { format: "reel", video: video({ sizeBytes: 300 * 1024 * 1024 }) }),
    false,
  );
  expect("over 250 MB is refused", has(big, "facebook", "over 250 MB", "error"));
  const promo = validatePost(
    draft(["facebook"], { format: "reel", video: video(), body: "Save {promoOffer}" }),
    false,
  );
  expect("a reel's caption still checks its placeholders", (promo.facebook ?? []).length > 0);
}

console.log("\nStories");
{
  const tall = { imageWidth: 1080, imageHeight: 1920 };
  const fine = validatePost(draft(["facebook", "instagram"], { format: "story", ...tall }), false);
  expectEqual("a 9:16 JPEG story is fine on Facebook", messages(fine, "facebook"), []);
  expectEqual("and on Instagram", messages(fine, "instagram"), []);

  const empty = validatePost(draft(["facebook"], { format: "story", imageUrl: null }), false);
  expect("a story needs a picture or video", has(empty, "facebook", "picture or a video", "error"));

  const png = validatePost(
    draft(["instagram", "facebook"], { format: "story", imageUrl: PNG, ...tall }),
    false,
  );
  expect("Instagram stories take JPEG only", has(png, "instagram", "JPEG", "error"));
  expect("Facebook takes the PNG", !(png.facebook ?? []).some((i) => i.level === "error"));

  const square = validatePost(draft(["facebook"], { format: "story" }), false);
  expect("a square picture only warns", has(square, "facebook", "9:16 portrait", "warning"));

  const both = validatePost(
    draft(["facebook"], { format: "story", video: video(), ...tall }),
    false,
  );
  expect("with both, it says the video wins", has(both, "facebook", "uses the video", "warning"));
  const minute = validatePost(
    draft(["facebook"], { format: "story", imageUrl: null, video: video({ durationMs: 61_000 }) }),
    false,
  );
  expect("a story video stops at 60 seconds", has(minute, "facebook", "up to 60 seconds", "error"));
  const reelLength = validatePost(
    draft(["facebook"], { format: "reel", video: video({ durationMs: 61_000 }) }),
    false,
  );
  expect(
    "while a reel of 61 seconds is fine",
    !(reelLength.facebook ?? []).some((i) => i.level === "error"),
  );

  const words = validatePost(
    draft(["facebook"], { format: "story", ...tall, body: "Save {promoOffer}" }),
    false,
  );
  expectEqual(
    "a story skips the placeholder checks: it shows no words",
    messages(words, "facebook"),
    [],
  );
}

console.log("\nCover photos");
{
  const fine = validatePost(
    draft(["facebook"], { format: "cover", imageWidth: 1640, imageHeight: 624 }),
    false,
  );
  expectEqual("1640 x 624 is fine", messages(fine, "facebook"), []);
  const none = validatePost(draft(["facebook"], { format: "cover", imageUrl: null }), false);
  expect("a cover needs a picture", has(none, "facebook", "needs a picture", "error"));
  const small = validatePost(
    draft(["facebook"], { format: "cover", imageWidth: 300, imageHeight: 120 }),
    false,
  );
  expect("too small is refused", has(small, "facebook", "at least 400 x 150", "error"));
  const square = validatePost(draft(["facebook"], { format: "cover" }), false);
  expect("a square only warns", has(square, "facebook", "2.6:1", "warning"));
  const ig = validatePost(
    draft(["instagram"], { format: "cover", imageWidth: 1640, imageHeight: 624 }),
    false,
  );
  expect("Instagram has no cover", has(ig, "instagram", "doesn't take cover photos", "error"));
}

console.log("\nSeveral pictures");
{
  /**
   * A square JPEG after the first picture.
   * @param n - Its place in the post.
   * @returns The picture.
   */
  const square = (n: number): DraftMedia => ({
    url: `${HOST}/social/image-m${n}.jpg`,
    width: 1080,
    height: 1080,
  });
  const three = [square(2), square(3)];
  const issues = validatePost(
    draft(["facebook", "instagram", "google"], { moreImages: three }),
    false,
  );
  expect("Facebook says it makes a grid", has(issues, "facebook", "grid", "warning"));
  expect("Google says it shows picture 1", has(issues, "google", "first picture only", "warning"));
  expect(
    "Instagram takes three matching squares",
    !(issues.instagram ?? []).some((i) => i.level === "error"),
  );
  expect("with no shape warning", !has(issues, "instagram", "picture 1's shape"));

  const mixed = validatePost(
    draft(["instagram"], {
      moreImages: [{ url: `${HOST}/social/image-w.jpg`, width: 1910, height: 1000 }],
    }),
    false,
  );
  expect(
    "a wide picture after a square warns it gets cut",
    has(mixed, "instagram", "picture 1's shape", "warning"),
  );

  const png = validatePost(
    draft(["instagram"], { moreImages: [{ url: PNG, width: 1080, height: 1080 }] }),
    false,
  );
  expect(
    "a PNG picture 2 is named",
    has(png, "instagram", "Picture 2: Instagram only takes JPEG", "error"),
  );

  const headless = validatePost(draft(["facebook"], { imageUrl: null, moreImages: three }), false);
  expect(
    "pictures with no picture 1 ask for one up front",
    has(headless, "facebook", "first picture is missing", "error"),
  );

  const many = Array.from({ length: 10 }, (_, i) => square(i + 2));
  const lots = validatePost(draft(["facebook"], { moreImages: many }), false);
  expect("11 pictures is too many", has(lots, "facebook", "10 pictures at most", "error"));
}

console.log("\nInstagram containers");
{
  const one = instagramContainers(input());
  expectEqual("one picture: one container with the caption", one, {
    children: [],
    main: { image_url: JPEG, caption: "Caption" },
    what: "picture",
  });

  const two = instagramContainers(
    input({
      images: [
        { url: JPEG, alt: null },
        { url: `${HOST}/social/image-2.jpg`, alt: null },
      ],
    }),
  );
  expectEqual("a carousel: one child per picture", two.children, [
    { image_url: JPEG, is_carousel_item: "true" },
    { image_url: `${HOST}/social/image-2.jpg`, is_carousel_item: "true" },
  ]);
  expectEqual("and a CAROUSEL parent with the caption", two.main, {
    media_type: "CAROUSEL",
    caption: "Caption",
  });

  const reel = instagramContainers(
    input({ format: "reel", video: { url: VIDEO, coverUrl: FRAME } }),
  );
  expectEqual("a reel goes to the feed too, with its cover", reel.main, {
    media_type: "REELS",
    video_url: VIDEO,
    caption: "Caption",
    share_to_feed: "true",
    cover_url: FRAME,
  });
  const bare = instagramContainers(
    input({ format: "reel", video: { url: VIDEO, coverUrl: null } }),
  );
  expect("a reel with no frame leaves the cover to Instagram", !("cover_url" in bare.main));

  const storyVideo = instagramContainers(
    input({ format: "story", video: { url: VIDEO, coverUrl: FRAME } }),
  );
  expectEqual("a video story has no caption", storyVideo.main, {
    media_type: "STORIES",
    video_url: VIDEO,
  });
  const storyPicture = instagramContainers(input({ format: "story" }));
  expectEqual("a picture story", storyPicture.main, { media_type: "STORIES", image_url: JPEG });

  let threw = "";
  try {
    instagramContainers(input({ format: "cover" }));
  } catch (error) {
    threw = error instanceof Error ? error.message : "";
  }
  expect("a cover is refused", threw.includes("cover"));
  threw = "";
  try {
    instagramContainers(input({ format: "reel" }));
  } catch (error) {
    threw = error instanceof Error ? error.message : "";
  }
  expect("a reel with no video is refused", threw.includes("video"));
}

console.log("\nFacebook parameters");
expectEqual(
  "the link goes on the end",
  facebookCaption("Hi", "https://x.nz/b"),
  "Hi\n\nhttps://x.nz/b",
);
expectEqual("no link, no change", facebookCaption("Hi", null), "Hi");
expectEqual("a link alone", facebookCaption("", "https://x.nz/b"), "https://x.nz/b");
expectEqual("photos join one post in order", albumParams("Hi", ["p1", "p2"]), {
  message: "Hi",
  attached_media: '[{"media_fbid":"p1"},{"media_fbid":"p2"}]',
});
expectEqual("a reel's finish publishes it", reelFinishParams("v1", "Hi"), {
  upload_phase: "finish",
  video_id: "v1",
  video_state: "PUBLISHED",
  description: "Hi",
});

console.log("\nWaiting on a video");
{
  const now = new Date("2026-10-22T01:00:00.000Z");
  /**
   * A time before now.
   * @param ms - How long before.
   * @returns The time.
   */
  const ago = (ms: number): Date => new Date(now.getTime() - ms);
  const stuck = 10 * 60_000;
  expect(
    "a wait that's over is due",
    resumeDue({ resumeAfter: ago(1), postingStartedAt: ago(5 * 60_000) }, now, stuck),
  );
  expect(
    "a wait still running isn't",
    !resumeDue({ resumeAfter: ago(-60_000), postingStartedAt: ago(60 * 60_000) }, now, stuck),
  );
  expect(
    "no wait and quiet past the stuck window is due",
    resumeDue({ resumeAfter: null, postingStartedAt: ago(stuck + 1) }, now, stuck),
  );
  expect(
    "no wait and recent isn't",
    !resumeDue({ resumeAfter: null, postingStartedAt: ago(60_000) }, now, stuck),
  );
  expect(
    "nothing to go on isn't",
    !resumeDue({ resumeAfter: null, postingStartedAt: null }, now, stuck),
  );
  expect("an unknown container age never expires", !containerExpired(null, now));
  expect("23 hours in is still processing", !containerExpired(ago(CONTAINER_TTL_MS - 60_000), now));
  expect("a day in, it's dropped", containerExpired(ago(CONTAINER_TTL_MS), now));
}

console.log("\nCard pictures");
{
  const base = {
    imageUrl: JPEG,
    imageAlt: "A phone",
    imageWidth: 1080,
    imageHeight: 1080,
    targets: [],
  };
  const frame = {
    kind: "video" as const,
    url: VIDEO,
    alt: "Clip",
    width: 1080,
    height: 1920,
    durationMs: 12_000,
    sizeBytes: 1,
    coverUrl: FRAME,
  };
  expectEqual(
    "a reel shows its frame",
    coverOf({ ...base, format: "reel", video: frame })?.url,
    FRAME,
  );
  expectEqual(
    "a video story shows its frame",
    coverOf({ ...base, format: "story", video: frame })?.url,
    FRAME,
  );
  expectEqual(
    "a post with a stray video shows its picture",
    coverOf({ ...base, format: "feed", video: frame })?.url,
    JPEG,
  );
  expectEqual(
    "a cover shows its picture",
    coverOf({ ...base, format: "cover", video: null })?.url,
    JPEG,
  );
  expectEqual(
    "a reel with no frame falls back to the picture",
    coverOf({ ...base, format: "reel", video: { ...frame, coverUrl: null } })?.url,
    JPEG,
  );
}

console.log("\nMedia edits");
{
  const bad = parsePostPatch({ format: "carousel" });
  expect("an unknown kind is refused", "error" in bad);
  const feed = parsePostPatch({ format: null });
  expect("null resets to an ordinary post", "patch" in feed && feed.patch.format === null);

  const tooMany = parsePostPatch({
    moreImages: Array.from({ length: 10 }, (_, i) => ({ url: `${HOST}/social/image-${i}.jpg` })),
  });
  expect("10 more pictures is too many", "error" in tooMany);

  const outside = parsePostPatch({ moreImages: [{ url: "https://example.com/a.jpg" }] });
  expect("pictures must be uploaded here", "error" in outside);

  const loose = parsePostPatch({ video: { url: `${HOST}/social/image-x.mp4`, durationMs: 5000 } });
  expect("a video must sit with the uploaded videos", "error" in loose);

  const good = parsePostPatch({
    video: {
      url: VIDEO,
      coverUrl: FRAME,
      width: 1080,
      height: 1920,
      durationMs: 12_000,
      sizeBytes: 9,
    },
  });
  expectEqual("an uploaded video comes through whole", "patch" in good ? good.patch.video : good, {
    kind: "video",
    url: VIDEO,
    alt: null,
    width: 1080,
    height: 1920,
    durationMs: 12_000,
    sizeBytes: 9,
    coverUrl: FRAME,
  });
  const gone = parsePostPatch({ video: null });
  expect("null takes the video off", "patch" in gone && gone.patch.video === null);
}

console.log("\nA photo in a story");
{
  const box = { x: 0, y: 268.8, w: 1080, h: 1267.2 };
  expectEqual("a square fits the safe area's width, centred", placeIn(1000, 1000, box, false), {
    x: 0,
    y: 268.8 + (1267.2 - 1080) / 2,
    w: 1080,
    h: 1080,
  });
  const tall = placeIn(1080, 1920, box, false);
  expect(
    "a 9:16 photo fits the safe area's height",
    Math.abs(tall.h - 1267.2) < 1e-9 && tall.w < 1080,
  );
  const back = placeIn(1000, 1000, { x: -80, y: -80, w: 1240, h: 2080 }, true);
  expectEqual("the blurred copy covers the whole screen", [back.w, back.h], [2080, 2080]);
  expectEqual("centred across", back.x, -80 + (1240 - 2080) / 2);
}

finish();
