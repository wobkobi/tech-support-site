// src/features/social/lib/publish.ts
// Publishing a social post to every enabled platform, and taking it down again. Same
// claim-then-work shape as the mailing send: an atomic status flip stops a double-click
// or the cron racing a manual publish from posting twice, and each platform's outcome is
// recorded on its target so a retry or a resumed run only touches the platforms still
// pending.

import { promoWording } from "@/features/mailing/lib/context";
import type { PromoWording } from "@/features/mailing/lib/render";
import { StillProcessingError } from "@/features/social/lib/adapter";
import { PLATFORMS } from "@/features/social/lib/platforms";
import {
  applyTakeDown,
  freshRun,
  resetFailed,
  rollUpStatus,
  statusAfterTakeDown,
  takeDownDue,
  type TakeDownOutcome,
  type TargetState,
} from "@/features/social/lib/targets";
import {
  PLATFORM_LABEL,
  SOCIAL_PLATFORMS,
  blockingIssues,
  fillPromo,
  textFor,
  validatePost,
  type SocialPlatformKey,
} from "@/features/social/lib/validate";
import { prisma } from "@/shared/lib/prisma";
import type { SocialPost } from "@prisma/client";

// A run "posting" for longer than this died part-way, and the cron resumes it. A
// take-down "removing" for longer can be claimed again from the composer.
const STUCK_AFTER_MS = 10 * 60 * 1000;

/** Outcome of a publish, retry or schedule. */
export type PublishOutcome =
  | { ok: true; status: SocialPost["status"]; targets: TargetState[] }
  | { ok: false; error: string; status: number };

/**
 * Whether a platform key has an adapter yet.
 * @param platform - Stored platform name.
 * @returns True for the platforms in {@link SOCIAL_PLATFORMS}.
 */
function isLive(platform: string): platform is SocialPlatformKey {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(platform);
}

/**
 * Env vars an enabled platform still needs, as one readable line per platform.
 * @param post - The post.
 * @returns Messages, empty when everything enabled is set up.
 */
function missingSetup(post: Pick<SocialPost, "targets">): string[] {
  return post.targets
    .filter((t) => t.enabled && isLive(t.platform))
    .flatMap((t) => {
      const missing = PLATFORMS[t.platform as SocialPlatformKey].missingEnv();
      return missing.length > 0
        ? [
            `${PLATFORM_LABEL[t.platform as SocialPlatformKey]} is off until ${missing.join(", ")} is set.`,
          ]
        : [];
    });
}

/**
 * Checks a post can go out right now: platforms set up, linked promo still live, and
 * no validator errors.
 * @param post - The post.
 * @returns The promo wording to fill with, or the reason it can't go.
 */
export async function readiness(
  post: SocialPost,
): Promise<
  { ok: true; promo: PromoWording | null } | { ok: false; error: string; status: number }
> {
  const missing = missingSetup(post);
  if (missing.length > 0) return { ok: false, error: missing.join(" "), status: 503 };
  const { promo, linkedPromoLive } = await promoWording(post.promoId);
  if (!linkedPromoLive) {
    return {
      ok: false,
      error: "The promo this post is about has ended or been switched off.",
      status: 409,
    };
  }
  const problems = blockingIssues(validatePost(post, promo !== null));
  if (problems.length > 0) return { ok: false, error: problems.join(" "), status: 400 };
  return { ok: true, promo };
}

/**
 * What stops a post being scheduled. A promo can start after the schedule is set,
 * so promo placeholders and a linked promo are only checked when it goes out.
 * @param post - The post.
 * @returns Problems with their HTTP status, or null when it can be scheduled.
 */
export function scheduleProblems(post: SocialPost): { error: string; status: number } | null {
  const missing = missingSetup(post);
  if (missing.length > 0) return { error: missing.join(" "), status: 503 };
  const problems = blockingIssues(validatePost(post, true));
  return problems.length > 0 ? { error: problems.join(" "), status: 400 } : null;
}

/**
 * Puts a claimed post back to draft when it can't go ahead, so it reappears in
 * Drafts for the operator to fix rather than sitting in "posting".
 * @param id - Post id.
 */
async function releaseToDraft(id: string): Promise<void> {
  await prisma.socialPost.update({
    where: { id },
    data: { status: "draft", scheduledAt: null, postingStartedAt: null },
  });
}

/**
 * Publishes every enabled target still pending, all platforms at once, then records
 * each outcome and the status they add up to.
 * @param post - The claimed post.
 * @param targets - Targets to run from (pending ones get published).
 * @param promo - Promo wording for the placeholders.
 * @returns The final targets and status.
 */
async function runPending(
  post: SocialPost,
  targets: TargetState[],
  promo: PromoWording | null,
): Promise<{ status: SocialPost["status"]; targets: TargetState[] }> {
  const due = targets.filter((t) => t.enabled && t.status === "pending" && isLive(t.platform));
  const settled = await Promise.allSettled(
    due.map((t) =>
      PLATFORMS[t.platform as SocialPlatformKey].publish({
        text: fillPromo(textFor(post, t.platform), promo).trim(),
        imageUrl: post.imageUrl,
        imageAlt: post.imageAlt,
        linkUrl: post.linkUrl,
      }),
    ),
  );

  const now = new Date();
  const outcomes = new Map(due.map((t, i) => [t.platform, settled[i]!]));
  const next = targets.map((t): TargetState => {
    const outcome = outcomes.get(t.platform);
    if (!outcome) return t;
    if (outcome.status === "fulfilled") {
      return { ...t, status: "posted", ...outcome.value, error: null, postedAt: now };
    }
    const reason = outcome.reason;
    // Accepted but still processing: stays pending for the cron's resume pass.
    if (reason instanceof StillProcessingError) return { ...t, error: reason.message };
    const message = reason instanceof Error ? reason.message : "Posting failed.";
    return { ...t, status: "failed", error: message.slice(0, 500) };
  });

  const status = rollUpStatus(next);
  await prisma.socialPost.update({
    where: { id: post.id },
    data: {
      targets: next,
      status,
      ...(status === "posting"
        ? {}
        : { postedAt: post.postedAt ?? now, postingStartedAt: null, scheduledAt: null }),
    },
  });
  return { status, targets: next };
}

/**
 * Publishes a draft or scheduled post now.
 * @param id - Post id.
 * @returns The outcome per platform, or the reason it didn't go.
 */
export async function publishPost(id: string): Promise<PublishOutcome> {
  const claimed = await prisma.socialPost.updateMany({
    where: { id, isPreset: false, status: { in: ["draft", "scheduled"] } },
    data: { status: "posting", postingStartedAt: new Date() },
  });
  if (claimed.count === 0) {
    return { ok: false, error: "This post is already posting or has been posted.", status: 409 };
  }
  const post = await prisma.socialPost.findUniqueOrThrow({ where: { id } });
  const ready = await readiness(post);
  if (!ready.ok) {
    await releaseToDraft(id);
    return ready;
  }
  return { ok: true, ...(await runPending(post, freshRun(post.targets), ready.promo)) };
}

/**
 * Re-posts only to the platforms that failed last time.
 * @param id - Post id.
 * @returns The outcome per platform, or the reason it didn't run.
 */
export async function retryFailed(id: string): Promise<PublishOutcome> {
  const before = await prisma.socialPost.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "Post not found.", status: 404 };
  const ready = await readiness(before);
  if (!ready.ok) return ready;

  const claimed = await prisma.socialPost.updateMany({
    where: { id, status: { in: ["partial", "failed"] } },
    data: { status: "posting", postingStartedAt: new Date() },
  });
  if (claimed.count === 0) {
    return { ok: false, error: "There's nothing to retry on this post.", status: 409 };
  }
  const post = await prisma.socialPost.findUniqueOrThrow({ where: { id } });
  return { ok: true, ...(await runPending(post, resetFailed(post.targets), ready.promo)) };
}

/**
 * Deletes a post from every platform it's up on. Claimed with a status flip to
 * "removing", like a publish, so a double-click can't run two take-downs and a retry
 * can't post while one runs. A take-down that died part-way stays "removing" until
 * {@link STUCK_AFTER_MS} passes, then pressing Take down again claims it; a platform it
 * already reached comes back as already deleted, which counts as done.
 * @param id - Post id.
 * @returns The outcome per platform, or the reason it didn't run.
 */
export async function takeDownPost(id: string): Promise<PublishOutcome> {
  const before = await prisma.socialPost.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "Post not found.", status: 404 };
  if (takeDownDue(before.targets).length === 0) {
    return {
      ok: false,
      error: "This post isn't up anywhere, so there's nothing to take down.",
      status: 409,
    };
  }

  const now = new Date();
  const claimed = await prisma.socialPost.updateMany({
    where: {
      id,
      OR: [
        { status: { in: ["posted", "partial"] } },
        { status: "removing", postingStartedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
      ],
    },
    data: { status: "removing", postingStartedAt: now },
  });
  if (claimed.count === 0) {
    return {
      ok: false,
      error:
        before.status === "posting"
          ? "This post is still going out. Take it down once it has finished."
          : "This post is already being taken down.",
      status: 409,
    };
  }

  const post = await prisma.socialPost.findUniqueOrThrow({ where: { id } });
  const due = takeDownDue(post.targets);
  const settled = await Promise.allSettled(
    due.map(async (t) => {
      if (!isLive(t.platform)) throw new Error("Taking it down isn't supported here yet.");
      if (!t.externalId) {
        throw new Error("Its post id wasn't saved, so delete it on the platform itself.");
      }
      await PLATFORMS[t.platform].remove(t.externalId);
    }),
  );
  const outcomes = new Map<TargetState["platform"], TakeDownOutcome>(
    due.map((t, i) => {
      const result = settled[i]!;
      if (result.status === "fulfilled") return [t.platform, { ok: true }];
      const reason = result.reason;
      return [
        t.platform,
        { ok: false, error: reason instanceof Error ? reason.message : "Taking it down failed." },
      ];
    }),
  );

  const targets = applyTakeDown(post.targets, outcomes, new Date());
  const status = statusAfterTakeDown(targets);
  await prisma.socialPost.update({
    where: { id },
    data: { targets, status, postingStartedAt: null },
  });
  return { ok: true, status, targets };
}

/**
 * Cron: publishes scheduled posts that are due, then resumes any run that died
 * part-way or is waiting on Instagram's processing. Runs inside quiet hours too:
 * a post wakes nobody, so the time the operator picked is the time it goes.
 * @returns One line per post touched.
 */
export async function runScheduledSocialPosts(): Promise<
  { id: string; name: string; result: PublishOutcome }[]
> {
  const now = new Date();
  const results: { id: string; name: string; result: PublishOutcome }[] = [];

  const due = await prisma.socialPost.findMany({
    where: { isPreset: false, status: "scheduled", scheduledAt: { lte: now } },
    select: { id: true, name: true },
    orderBy: { scheduledAt: "asc" },
  });
  for (const p of due) {
    results.push({ id: p.id, name: p.name, result: await publishPost(p.id) });
  }

  const stuck = await prisma.socialPost.findMany({
    where: {
      status: "posting",
      postingStartedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) },
    },
  });
  for (const post of stuck) {
    // Re-claim by the old timestamp so two overlapping cron runs can't both resume it.
    const claimed = await prisma.socialPost.updateMany({
      where: { id: post.id, status: "posting", postingStartedAt: post.postingStartedAt },
      data: { postingStartedAt: new Date() },
    });
    if (claimed.count === 0) continue;
    const ready = await readiness(post);
    let targets = post.targets;
    if (!ready.ok) {
      // Some platforms may already have it, so close the run rather than release it:
      // the rest fail with the reason, and Retry is there once it's fixed.
      targets = targets.map((t) =>
        t.enabled && t.status === "pending" ? { ...t, status: "failed", error: ready.error } : t,
      );
    }
    const done = await runPending(post, targets, ready.ok ? ready.promo : null);
    results.push({ id: post.id, name: post.name, result: { ok: true, ...done } });
  }
  return results;
}
