// src/features/social/lib/publish.ts
// Publishes a social post to every enabled platform and takes it down. An atomic status claim
// stops double posts; per-target outcomes let retries touch only pending platforms.

import { promoWording } from "@/features/mailing/lib/context";
import type { PromoWording } from "@/features/mailing/lib/render";
import { sendOwnerPush } from "@/features/notifications/lib/push";
import type { PublishResult } from "@/features/social/lib/adapter";
import { NOT_CONTENT } from "@/features/social/lib/filters";
import { postHref } from "@/features/social/lib/links";
import {
  RESUME_AFTER_MS,
  canTakeDown,
  containerExpired,
  formatOf,
} from "@/features/social/lib/media";
import { PLATFORMS } from "@/features/social/lib/platforms";
import {
  afterPublish,
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
  dateKey,
  fillPromo,
  pictureFor,
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
      const missing = PLATFORMS[t.platform].missingEnv();
      return missing.length > 0
        ? [`${PLATFORM_LABEL[t.platform]} is off until ${missing.join(", ")} is set.`]
        : [];
    });
}

/**
 * Checks a post can go out now: platforms set up, promo live, no validator errors.
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
  const problems = blockingIssues(validatePost(post, promo !== null, promo));
  if (problems.length > 0) return { ok: false, error: problems.join(" "), status: 400 };
  return { ok: true, promo };
}

/**
 * What stops scheduling. Promo checks wait for send time, since a promo may start later.
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
 * Closes a scheduled post that can't go at its time as failed, keeping its slot, so it shows
 * under problems with Retry, and tells the owner. Claimed from "scheduled", so one push.
 * @param post - The post.
 * @param error - Why it can't go.
 */
async function failAtSendTime(post: SocialPost, error: string): Promise<void> {
  const targets = freshRun(post.targets).map((t): TargetState =>
    t.status === "pending" ? { ...t, status: "failed", error } : t,
  );
  const closed = await prisma.socialPost.updateMany({
    where: { id: post.id, status: "scheduled" },
    data: { status: "failed", targets },
  });
  if (closed.count === 0) return;
  await sendOwnerPush({
    title: "A scheduled post didn't go out",
    body: `"${post.name}" couldn't go at its time. Open it to see why.`,
    url: postHref(post),
    tag: `social-failed-${post.id}`,
  });
}

/**
 * Publishes every pending enabled target in parallel, then records the status. Each target is
 * saved as it settles, so a run that dies part-way can't post a finished app twice on resume.
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
  const started = new Date();
  const format = formatOf(post.format);
  const next = [...targets];
  let saving: Promise<unknown> = Promise.resolve();
  /** Saves the targets as they stand, queued behind the last save since each writes the lot. */
  const checkpoint = (): void => {
    const snapshot = [...next];
    saving = saving
      .then(() => prisma.socialPost.update({ where: { id: post.id }, data: { targets: snapshot } }))
      .catch((error: unknown) => console.error("[social/publish] checkpoint failed:", error));
  };

  await Promise.all(
    next.map(async (t, i) => {
      if (!t.enabled || t.status !== "pending" || !isLive(t.platform)) return;
      let outcome: PromiseSettledResult<PublishResult>;
      try {
        if (t.containerId && containerExpired(t.containerCreatedAt, started)) {
          throw new Error(
            `${PLATFORM_LABEL[t.platform]} dropped the upload after a day of processing. Press Retry to send it again.`,
          );
        }
        // The platform's own picture when it has one, with its own description.
        const first = pictureFor(post, t.platform);
        const firstAlt = t.imageUrl ? t.imageAlt : post.imageAlt;
        const more = format === "feed" ? post.moreImages : [];
        const value = await PLATFORMS[t.platform].publish({
          format,
          text: fillPromo(textFor(post, t.platform), promo).trim(),
          imageUrl: first?.url ?? null,
          imageAlt: firstAlt,
          images: first
            ? [{ url: first.url, alt: firstAlt }, ...more.map((m) => ({ url: m.url, alt: m.alt }))]
            : [],
          video: post.video ? { url: post.video.url, coverUrl: post.video.coverUrl } : null,
          linkUrl: post.linkUrl,
          containerId: t.containerId,
          containerCreatedAt: t.containerCreatedAt,
          google: {
            type: post.googleType,
            cta: post.googleCta,
            url: post.googleUrl,
            title: post.googleTitle,
            start: dateKey(post.offerStart),
            end: dateKey(post.offerEnd),
            startTime: post.eventStartTime,
            endTime: post.eventEndTime,
            couponCode: post.couponCode,
          },
        });
        outcome = { status: "fulfilled", value };
      } catch (reason) {
        outcome = { status: "rejected", reason };
      }
      next[i] = afterPublish(t, outcome, started, new Date());
      checkpoint();
    }),
  );
  await saving;

  const now = new Date();
  const status = rollUpStatus(next);
  await prisma.socialPost.update({
    where: { id: post.id },
    data: {
      targets: next,
      status,
      ...(status === "posting"
        ? { resumeAfter: new Date(now.getTime() + RESUME_AFTER_MS) }
        : {
            // Nothing went up on a failed run, so it keeps when it was tried instead.
            ...(status === "failed"
              ? {}
              : { postedAt: post.postedAt ?? now, postingStartedAt: null }),
            scheduledAt: null,
            resumeAfter: null,
          }),
    },
  });
  return { status, targets: next };
}

/**
 * Publishes a draft or scheduled post now. Readiness is checked before the claim, so a post
 * that can't go is left as it was.
 * @param id - Post id.
 * @param due - True when the cron sends it at its time: a post that can't go then fails where
 *   it stands, with a push, rather than staying scheduled for a time that has passed.
 * @returns The outcome per platform, or the reason it didn't go.
 */
export async function publishPost(id: string, due = false): Promise<PublishOutcome> {
  // Content items never go out themselves: their postings do.
  const claimable = {
    id,
    isPreset: false,
    status: { in: ["draft" as const, "scheduled" as const] },
    ...NOT_CONTENT,
  };
  const before = await prisma.socialPost.findFirst({ where: claimable });
  if (!before) {
    return { ok: false, error: "This post is already posting or has been posted.", status: 409 };
  }
  const ready = await readiness(before);
  if (!ready.ok) {
    if (due) await failAtSendTime(before, ready.error);
    return ready;
  }
  const claimed = await prisma.socialPost.updateMany({
    where: claimable,
    data: { status: "posting", postingStartedAt: new Date() },
  });
  if (claimed.count === 0) {
    return { ok: false, error: "This post is already posting or has been posted.", status: 409 };
  }
  const post = await prisma.socialPost.findUniqueOrThrow({ where: { id } });
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
 * Deletes a post everywhere, claimed by a flip to "removing". A stalled take-down can be
 * reclaimed after {@link STUCK_AFTER_MS}; platforms already reached report already deleted.
 * @param id - Post id.
 * @returns The outcome per platform, or the reason it didn't run.
 */
export async function takeDownPost(id: string): Promise<PublishOutcome> {
  const before = await prisma.socialPost.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "Post not found.", status: 404 };
  const format = formatOf(before.format);
  if (!canTakeDown(format)) {
    return {
      ok: false,
      error:
        format === "story"
          ? "The apps don't let stories be taken down early. They go on their own a day after they went up."
          : "A cover photo stays until you change it. Change it in Facebook, or post a new one from here.",
      status: 409,
    };
  }
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
 * Cron: publishes due scheduled posts, checks on runs a platform is still processing once their
 * wait is over, and resumes runs that stalled part-way. Ignores quiet hours, since a post wakes
 * nobody.
 * @returns One line per post touched.
 */
export async function runScheduledSocialPosts(): Promise<
  { id: string; name: string; result: PublishOutcome }[]
> {
  const now = new Date();
  const results: { id: string; name: string; result: PublishOutcome }[] = [];

  const due = await prisma.socialPost.findMany({
    where: { isPreset: false, status: "scheduled", scheduledAt: { lte: now }, ...NOT_CONTENT },
    select: { id: true, name: true },
    orderBy: { scheduledAt: "asc" },
  });
  for (const p of due) {
    results.push({ id: p.id, name: p.name, result: await publishPost(p.id, true) });
  }

  // A claimed run clears resumeAfter, so one still going is only picked up once it stalls.
  const stuck = await prisma.socialPost.findMany({
    where: {
      status: "posting",
      OR: [
        { resumeAfter: { lte: now } },
        {
          OR: [{ resumeAfter: null }, { resumeAfter: { isSet: false } }],
          postingStartedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) },
        },
      ],
    },
  });
  for (const post of stuck) {
    // Re-claim by the old timestamp so two overlapping cron runs can't both resume it.
    const claimed = await prisma.socialPost.updateMany({
      where: { id: post.id, status: "posting", postingStartedAt: post.postingStartedAt },
      data: { postingStartedAt: new Date(), resumeAfter: null },
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
