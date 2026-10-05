// src/features/social/lib/targets.ts
// Pure helpers for a post's per-platform targets: the starting set, how the targets'
// outcomes roll up into the post's status, and how a take-down is recorded. No database, so the check script
// covers them directly.

/** A target as stored on the post (mirrors the Prisma SocialTarget type). */
export interface TargetState {
  platform: "facebook" | "instagram" | "google";
  enabled: boolean;
  textOverride: string | null;
  status: "pending" | "posted" | "failed" | "skipped" | "removed";
  externalId: string | null;
  permalink: string | null;
  error: string | null;
  postedAt: Date | null;
  removedAt: Date | null;
}

/** One platform's take-down result: done, or why not. */
export type TakeDownOutcome = { ok: true } | { ok: false; error: string };

/**
 * One target per platform. Google stays off until its API access is approved.
 * @returns Fresh pending targets.
 */
export function defaultTargets(): TargetState[] {
  return (["facebook", "instagram", "google"] as const).map((platform) => ({
    platform,
    enabled: platform !== "google",
    textOverride: null,
    status: "pending",
    externalId: null,
    permalink: null,
    error: null,
    postedAt: null,
    removedAt: null,
  }));
}

/**
 * The post status its targets add up to. Disabled and taken-down targets don't
 * count. Anything still pending keeps the run open ("posting") for the cron to finish.
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
 * Resets failed targets to pending for a retry. Posted targets are left alone, so
 * a retry can never post twice to a platform that already has it.
 * @param targets - Current targets.
 * @returns New targets array.
 */
export function resetFailed(targets: TargetState[]): TargetState[] {
  return targets.map((t) =>
    t.enabled && t.status === "failed" ? { ...t, status: "pending", error: null } : t,
  );
}

/**
 * Resets every enabled target to pending and marks disabled ones skipped, for a
 * fresh publish of a draft (a duplicated post may carry old outcomes).
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
 * Records take-down results. A target that came down keeps its post id for the
 * record but drops its link, which now goes nowhere. One that didn't stays posted
 * with the reason, so pressing Take down again retries just that platform.
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
 * The post status after a take-down: "removed" once nothing is up anywhere,
 * otherwise what the targets still up add up to.
 * @param targets - Targets after the take-down.
 * @returns removed, or the roll-up of what's left.
 */
export function statusAfterTakeDown(
  targets: TargetState[],
): "removed" | ReturnType<typeof rollUpStatus> {
  return takeDownDue(targets).length === 0 ? "removed" : rollUpStatus(targets);
}
