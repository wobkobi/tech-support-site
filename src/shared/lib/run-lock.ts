// src/shared/lib/run-lock.ts
// Cross-process run lock for long jobs that must not overlap (sheet import,
// contacts sync). Backed by a Setting row keyed per job, so it holds across
// serverless instances - an in-memory flag would not, since the cron and a
// manual click can land on different machines.

import { prisma } from "@/shared/lib/prisma";

/** A lock older than this is treated as left behind by a crashed run and stolen. */
export const RUN_LOCK_TTL_MS = 10 * 60_000;

/**
 * Attempts to take a named run lock.
 *
 * Two steps, both race-safe. First a compare-and-set that atomically steals a
 * stale lock: the stored value is an ISO timestamp, which sorts
 * chronologically, so `value < staleThreshold` means older than the TTL, and
 * `updateMany` is a single atomic op per document - after the first caller
 * stamps the new time the row no longer satisfies a second caller's stale
 * filter. If nothing stale was there to steal, the lock is either held fresh or
 * absent, so it tries to create the row; the unique `key` index makes
 * concurrent creates race-safe, with only one winner.
 * @param key - Setting key identifying this job's lock.
 * @param ttlMs - Age past which an existing lock is considered abandoned.
 * @returns True when the lock was acquired and the caller may proceed.
 */
export async function acquireRunLock(
  key: string,
  ttlMs: number = RUN_LOCK_TTL_MS,
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const staleThreshold = new Date(Date.now() - ttlMs).toISOString();
  const stolen = await prisma.setting.updateMany({
    where: { key, value: { lt: staleThreshold } },
    data: { value: nowIso },
  });
  if (stolen.count === 1) return true;
  try {
    await prisma.setting.create({ data: { key, value: nowIso } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Releases a named run lock. Never throws - a leftover lock expires via its TTL,
 * so failing to release delays the next run rather than blocking it forever.
 * @param key - Setting key identifying this job's lock.
 */
export async function releaseRunLock(key: string): Promise<void> {
  try {
    await prisma.setting.deleteMany({ where: { key } });
  } catch (err) {
    console.warn(`[run-lock] Failed to release ${key}:`, err);
  }
}

/**
 * Whether a job is currently running, for UI that needs to reflect real state
 * rather than a local flag. A lock past its TTL reads as not running, matching
 * what {@link acquireRunLock} would do with it.
 * @param key - Setting key identifying this job's lock.
 * @param ttlMs - Age past which an existing lock is considered abandoned.
 * @returns True when a live lock is held.
 */
export async function isRunLocked(key: string, ttlMs: number = RUN_LOCK_TTL_MS): Promise<boolean> {
  const row = await prisma.setting.findFirst({ where: { key }, select: { value: true } });
  if (!row) return false;
  return row.value >= new Date(Date.now() - ttlMs).toISOString();
}
