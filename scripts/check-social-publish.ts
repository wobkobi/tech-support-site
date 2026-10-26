// scripts/check-social-publish.ts
// Social publishing when Meta's answer is lost: each target's outcome, the Graph wrapper's
// "may have gone through" flag, Instagram keeping its container for the next pass, and Facebook
// looking for the post on the Page before calling it failed. Fetch is stubbed, so nothing leaves.
// Run with: npm test -- social-publish

import { StillProcessingError, type PublishInput } from "@/features/social/lib/adapter";
import { facebook } from "@/features/social/lib/facebook";
import { instagram } from "@/features/social/lib/instagram";
import { GraphError, graph, isUnsure } from "@/features/social/lib/meta-graph";
import { afterPublish, defaultTargets, type TargetState } from "@/features/social/lib/targets";
import { expect, expectEqual, finish } from "./lib/harness.js";

process.env.META_PAGE_ACCESS_TOKEN = "test-token";
process.env.META_PAGE_ID = "111";
process.env.INSTAGRAM_ACCOUNT_ID = "222";

/** One stubbed Graph answer: a JSON body and status, or a thrown error. */
type Answer = { status: number; body: unknown } | { throws: unknown };

/**
 * Points fetch at a handler, for the length of one check.
 * @param handle - Picks the answer for a method and path.
 */
function stubFetch(handle: (method: string, path: string) => Answer): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const answer = handle(init?.method ?? "GET", url.pathname.replace(/^\/v[\d.]+/, ""));
    if ("throws" in answer) throw answer.throws;
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as typeof fetch;
}

const TIMEOUT = new DOMException("The operation was aborted due to timeout", "TimeoutError");

/**
 * A feed post to publish, with any fields overridden.
 * @param over - Fields to change.
 * @returns The input.
 */
function input(over: Partial<PublishInput> = {}): PublishInput {
  return {
    format: "feed",
    text: "Computer running slow? Book a visit.",
    imageUrl: null,
    imageAlt: null,
    images: [],
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

/**
 * What a call threw, or null when it didn't.
 * @param run - The call.
 * @returns The error.
 */
async function thrown(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

/** Each target's state once its publish settles. */
function checkOutcomes(): void {
  console.log("Outcomes");
  const started = new Date("2026-10-26T01:00:00Z");
  const now = new Date("2026-10-26T01:00:20Z");
  const pending: TargetState = {
    ...defaultTargets()[1]!,
    containerId: "c1",
    containerCreatedAt: started,
  };

  const posted = afterPublish(
    pending,
    { status: "fulfilled", value: { externalId: "m1", permalink: "https://instagram.com/p/x" } },
    started,
    now,
  );
  expectEqual(
    "posted: id, link and time kept, container dropped",
    [posted.status, posted.externalId, posted.postedAt?.toISOString(), posted.containerId],
    ["posted", "m1", now.toISOString(), null],
  );

  const earlier = new Date("2026-10-25T23:00:00Z");
  const same = afterPublish(
    { ...pending, containerCreatedAt: earlier },
    { status: "rejected", reason: new StillProcessingError("Still going.", "c1") },
    started,
    now,
  );
  expectEqual(
    "still processing the same container: stays pending, keeps when it was made",
    [same.status, same.containerId, same.containerCreatedAt?.toISOString()],
    ["pending", "c1", earlier.toISOString()],
  );

  const handed = afterPublish(
    { ...pending, containerId: null, containerCreatedAt: null },
    { status: "rejected", reason: new StillProcessingError("Didn't answer.", "c2") },
    started,
    now,
  );
  expectEqual(
    "a container this run handed over is dated from the run's start",
    [handed.status, handed.containerId, handed.containerCreatedAt?.toISOString()],
    ["pending", "c2", started.toISOString()],
  );

  const failed = afterPublish(
    pending,
    { status: "rejected", reason: new Error("No.") },
    started,
    now,
  );
  expectEqual(
    "failed: the reason kept, the container dropped",
    [failed.status, failed.error, failed.containerId],
    ["failed", "No.", null],
  );
}

/** The Graph wrapper marks only a POST that may have gone through. */
async function checkUnsure(): Promise<void> {
  console.log("Unsure answers");
  stubFetch(() => ({ throws: TIMEOUT }));
  const post = await thrown(() => graph("/111/feed", "POST", { message: "x" }));
  expect("an unanswered POST is unsure", isUnsure(post));
  const get = await thrown(() => graph("/111", "GET"));
  expect("an unanswered GET is passed on as it was", get === TIMEOUT && !isUnsure(get));

  stubFetch(() => ({ status: 500, body: { error: { code: 1, message: "Unknown error" } } }));
  expect(
    "a POST answered with a server error is unsure",
    isUnsure(await thrown(() => graph("/111/feed", "POST", {}))),
  );
  stubFetch(() => ({ status: 400, body: { error: { code: 100, message: "Bad param" } } }));
  const refused = await thrown(() => graph("/111/feed", "POST", {}));
  expect("a refused POST is not unsure", refused instanceof GraphError && !isUnsure(refused));
}

/** Instagram keeps the container when the publish call goes unanswered. */
async function checkInstagram(): Promise<void> {
  console.log("Instagram");
  stubFetch((method, path) =>
    method === "GET" && path === "/c1"
      ? { status: 200, body: { status_code: "FINISHED" } }
      : path === "/222/media_publish"
        ? { throws: TIMEOUT }
        : { status: 404, body: { error: { code: 100, message: "Unexpected call" } } },
  );
  const picture = "https://abc.public.blob.vercel-storage.com/social/image-x1.jpg";
  const error = await thrown(() =>
    instagram.publish(
      input({ imageUrl: picture, images: [{ url: picture, alt: null }], containerId: "c1" }),
    ),
  );
  expect(
    "an unanswered publish leaves the container to check next pass",
    error instanceof StillProcessingError && error.containerId === "c1",
    String(error),
  );
}

/** Facebook looks for the post on the Page before calling it failed. */
async function checkFacebook(): Promise<void> {
  console.log("Facebook");
  const text = input().text;
  /**
   * The Page's posts for the lookup.
   * @param message - The newest post's words.
   * @returns A stub that loses the /feed answer and lists that post.
   */
  const lostAnswer =
    (message: string) =>
    (method: string, path: string): Answer =>
      method === "POST" && path === "/111/feed"
        ? { throws: TIMEOUT }
        : path === "/111/posts"
          ? {
              status: 200,
              body: {
                data: [{ id: "111_9", message, created_time: new Date().toISOString() }],
              },
            }
          : { status: 404, body: { error: { code: 100, message: "Unexpected call" } } };

  stubFetch(lostAnswer(text));
  const found = await facebook.publish(input()).catch((error: unknown) => error);
  expectEqual("a lost answer whose post is on the Page counts as posted", found, {
    externalId: "111_9",
    permalink: null,
  });

  stubFetch(lostAnswer("Something else"));
  const missing = await thrown(() => facebook.publish(input()));
  expect(
    "not on the Page: fails with a warning to look before Retry",
    missing instanceof Error && missing.message.includes("before pressing Retry"),
    String(missing),
  );
}

/** Runs every group and exits non-zero on any failure. */
async function main(): Promise<void> {
  checkOutcomes();
  await checkUnsure();
  await checkInstagram();
  await checkFacebook();
  finish();
}

void main();
