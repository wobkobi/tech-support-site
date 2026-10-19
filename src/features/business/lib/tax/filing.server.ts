// src/features/business/lib/tax/filing.server.ts
// Marks a FY filed (freezes TaxYear.snapshot, stamps filedAt) or unfiled (clears both).

import "server-only";

import { buildLiveSnapshot, resolveFinancialYear } from "@/features/business/lib/tax/view.server";
import { isRecordNotFound, isUniqueConflict } from "@/shared/lib/api-response";
import { prisma } from "@/shared/lib/prisma";
import { nzDayStartUtc } from "@/shared/lib/timezone-utils";
import type { Prisma } from "@prisma/client";

/** Result of a file or unfile request, mapped straight onto the route's response. */
export type FilingOutcome =
  { ok: true; filedAt: string | null } | { ok: false; error: string; status: 404 | 409 };

/**
 * Saves a year's current figures as its filed snapshot. Refuses a running year, and an
 * already-filed one (unfile first, so an amendment is deliberate).
 * @param fyKey - Key like "2025-26".
 * @param now - Reference instant; also the filing time.
 * @returns The outcome, with the filing time on success.
 */
export async function fileTaxYear(fyKey: string, now: Date): Promise<FilingOutcome> {
  const fy = await resolveFinancialYear(fyKey, now);
  if (!fy) return { ok: false, error: "Unknown financial year", status: 404 };
  // fy.end is UTC midnight 1 April on the ledger scale, so compare with today's NZ day.
  if (fy.end > nzDayStartUtc(now)) {
    return {
      ok: false,
      error: `FY ${fyKey} hasn't ended yet, so it can be marked filed from 1 April`,
      status: 409,
    };
  }
  const existing = await prisma.taxYear.findUnique({
    where: { fyKey },
    select: { filedAt: true },
  });
  if (existing?.filedAt) {
    return { ok: false, error: `FY ${fyKey} is already marked filed`, status: 409 };
  }

  const filedAt = now.toISOString();
  const { snapshot } = await buildLiveSnapshot(fy, now, filedAt);
  // Interfaces lack an index signature, so cast through unknown; the value is plain JSON.
  const json = snapshot as unknown as Prisma.InputJsonValue;
  /**
   * Creates the year's row filed, or stamps the existing one.
   * @returns The saved row's key.
   */
  const upsert = (): Promise<{ fyKey: string }> =>
    prisma.taxYear.upsert({
      where: { fyKey },
      create: { fyKey, filedAt: now, snapshot: json },
      update: { filedAt: now, snapshot: json },
      select: { fyKey: true },
    });
  try {
    await upsert();
  } catch (err) {
    // A racing first save from the home office form can win the create (P2002 on fyKey);
    // retry once, which now updates.
    if (!isUniqueConflict(err)) throw err;
    await upsert();
  }
  return { ok: true, filedAt };
}

/**
 * Clears a year's filed state and snapshot.
 * @param fyKey - Key like "2025-26".
 * @param now - Reference instant (bounds the FY list).
 * @returns The outcome; filedAt is null on success.
 */
export async function unfileTaxYear(fyKey: string, now: Date): Promise<FilingOutcome> {
  const fy = await resolveFinancialYear(fyKey, now);
  if (!fy) return { ok: false, error: "Unknown financial year", status: 404 };
  const existing = await prisma.taxYear.findUnique({
    where: { fyKey },
    select: { filedAt: true },
  });
  if (!existing?.filedAt) {
    return { ok: false, error: `FY ${fyKey} isn't marked filed`, status: 409 };
  }
  try {
    // On MongoDB a Json? field takes a plain null to clear it.
    await prisma.taxYear.update({
      where: { fyKey },
      data: { filedAt: null, snapshot: null },
      select: { fyKey: true },
    });
  } catch (err) {
    // The row was deleted between the read and the update (P2025).
    if (!isRecordNotFound(err)) throw err;
    return { ok: false, error: `FY ${fyKey} has no tax record`, status: 404 };
  }
  return { ok: true, filedAt: null };
}
