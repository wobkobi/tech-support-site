// src/features/social/lib/targets.ts
// Pure per-platform target helpers: initial set, status roll-up and take-down records.

/** A target as stored on the post (mirrors the Prisma SocialTarget type). */
export interface TargetState {
  platform: "facebook" | "instagram" | "google";
  enabled: boolean;
  textOverride: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  cropApprovedFor: string | null;
  imageOriginalUrl: string | null;
  status: "pending" | "posted" | "failed" | "skipped" | "removed";
  externalId: string | null;
  permalink: string | null;
  error: string | null;
  postedAt: Date | null;
  removedAt: Date | null;
  /** What the platform is still processing, so a resumed run checks it instead of starting over. */
  containerId: string | null;
  containerCreatedAt: Date | null;
}

/** One platform's take-down result: done, or why not. */
export type TakeDownOutcome = { ok: true } | { ok: false; error: string };

/**
 * One target per platform, all switched on.
 * @returns Fresh pending targets.
 */
export function defaultTargets(): TargetState[] {
  return (["facebook", "instagram", "google"] as const).map((platform) => ({
    platform,
    enabled: true,
    textOverride: null,
    imageUrl: null,
    imageAlt: null,
    imageWidth: null,
    imageHeight: null,
    cropApprovedFor: null,
    imageOriginalUrl: null,
    status: "pending",
    externalId: null,
    permalink: null,
    error: null,
    postedAt: null,
    removedAt: null,
    containerId: null,
    containerCreatedAt: null,
  }));
}

/**
 * The post status its targets add up to, ignoring disabled and taken-down ones; pending keeps it "posting".
 * @param targets - The post's targets after a run.
 * @returns posting, posted, partial or failed.
 */
export function rollUpStatus(targets: TargetState[]): "posting" | "posted" | "partial" | "failed" {
  const live = targets.filter((t) => t.enabled && t.status !== "removed");
  if (live.some((t) => t.status === "pending")) return "posting";
  const posted = live.filter((t) => t.status === "posted").length;
  if (posted === live.length) return "posted";
  return posted === 0 ? "failed" : "partial";
}

/**
 * Resets failed targets to pending; posted ones stay, so a retry never double-posts.
 * @param targets - Current targets.
 * @returns New targets array.
 */
export function resetFailed(targets: TargetState[]): TargetState[] {
  return targets.map((t) =>
    t.enabled && t.status === "failed"
      ? { ...t, status: "pending", error: null, containerId: null, containerCreatedAt: null }
      : t,
  );
}

/**
 * Resets enabled targets to pending and disabled to skipped, for a fresh publish.
 * @param targets - Current targets.
 * @returns New targets array.
 */
export function freshRun(targets: TargetState[]): TargetState[] {
  return targets.map((t) => ({
    ...t,
    status: t.enabled ? "pending" : "skipped",
    externalId: null,
    permalink: null,
    error: null,
    postedAt: null,
    removedAt: null,
    containerId: null,
    containerCreatedAt: null,
  }));
}

/**
 * Targets that are up on their platform, so a take-down has something to delete.
 * @param targets - Current targets.
 * @returns The posted ones.
 */
export function takeDownDue<T extends Pick<TargetState, "status">>(targets: T[]): T[] {
  return targets.filter((t) => t.status === "posted");
}

/**
 * Records take-down results: a removed target keeps its id but drops its dead link; a failed
 * one stays posted with the reason, so Take down retries just it.
 * @param targets - Targets before the take-down.
 * @param outcomes - Result per platform that was attempted.
 * @param now - When it ran.
 * @returns New targets array.
 */
export function applyTakeDown(
  targets: TargetState[],
  outcomes: Map<TargetState["platform"], TakeDownOutcome>,
  now: Date,
): TargetState[] {
  return targets.map((t): TargetState => {
    const outcome = outcomes.get(t.platform);
    if (!outcome) return t;
    return outcome.ok
      ? { ...t, status: "removed", permalink: null, error: null, removedAt: now }
      : { ...t, error: outcome.error.slice(0, 500) };
  });
}

/**
 * Status after a take-down: "removed" when nothing is up, else the roll-up of what's left.
 * @param targets - Targets after the take-down.
 * @returns removed, or the roll-up of what's left.
 */
export function statusAfterTakeDown(
  targets: TargetState[],
): "removed" | ReturnType<typeof rollUpStatus> {
  return takeDownDue(targets).length === 0 ? "removed" : rollUpStatus(targets);
}
