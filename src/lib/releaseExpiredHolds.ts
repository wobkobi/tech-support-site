// src/lib/releaseExpiredHolds.ts
/**
 * @file releaseExpiredHolds.ts
 * @description Utility to clean up old unconfirmed booking requests.
 * For this simplified system, "held" bookings are requests awaiting your confirmation.
 * You may want to auto-decline requests older than X days.
 */

import { prisma } from "@/lib/prisma";

/**
 * Default expiration for unconfirmed requests (in days).
 * Requests older than this are auto-declined.
 */
export const REQUEST_EXPIRATION_DAYS = 3;

/**
 * Result of the cleanup operation.
 */
export interface CleanupResult {
  /** Number of requests cleaned up. */
  cleanedCount: number;
  /** IDs of cleaned bookings. */
  cleanedIds: string[];
  /** Error if any. */
  error?: string;
}

/**
 * Remove old unconfirmed booking requests.
 * @param [expirationDays] - Days after which to expire requests.
 * @returns Cleanup result.
 */
export async function releaseExpiredHolds(
  expirationDays: number = REQUEST_EXPIRATION_DAYS,
): Promise<CleanupResult> {
  try {
    const cutoff = new Date(Date.now() - expirationDays * 24 * 60 * 60 * 1000);

    const expired = await prisma.booking.findMany({
      where: {
        status: "held",
        createdAt: { lt: cutoff },
      },
      select: { id: true },
    });

    if (expired.length === 0) {
      return { cleanedCount: 0, cleanedIds: [] };
    }

    const ids = expired.map((b) => b.id);

    // Mark as cancelled rather than delete (keeps history)
    await prisma.booking.updateMany({
      where: { id: { in: ids } },
      data: { status: "cancelled" },
    });

    return { cleanedCount: ids.length, cleanedIds: ids };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[releaseExpiredHolds] Error:", msg);
    return { cleanedCount: 0, cleanedIds: [], error: msg };
  }
}

/**
 * Get count of pending booking requests.
 * @returns Number of pending requests.
 */
export async function getPendingRequestCount(): Promise<number> {
  try {
    return await prisma.booking.count({ where: { status: "held" } });
  } catch {
    return 0;
  }
}
