// src/features/business/lib/tax/filing.server.ts
// Marks a financial year filed or unfiled. Filing freezes the year's live figures into
// TaxYear.snapshot and stamps filedAt; unfiling clears both, so the year goes back to live
// figures and the next year's opening asset values are recalculated.

import "server-only";

import { buildLiveSnapshot, resolveFinancialYear } from "@/features/business/lib/tax/view.server";
import { prisma } from "@/shared/lib/prisma";
import { nzDayStartUtc } from "@/shared/lib/timezone-utils";
import { Prisma } from "@prisma/client";

/** Result of a file or unfile request, mapped straight onto the route's response. */
export type FilingOutcome =
  { ok: true; filedAt: string | null } | { ok: false; error: string; status: 404 | 409 };

/**
 * Whether an error is Prisma's known-request error with the given code.
 * @param err - Caught error.
 * @param code - Prisma error code, e.g. "P2002".
 * @returns True when the codes match.
 */
function isPrismaError(err: unknown, code: string): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}

/**
 * Saves a year's current figures as its filed snapshot. Refuses a year that is still
 * running (its figures are part-year) and a year that is already filed (unfile first,
 * so an amendment is a deliberate step).
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
      error: `FY ${fyKey} hasn't ended yet. You can mark it filed from 1 April.`,
      status: 409,
    };
  }
  const existing = await prisma.taxYear.findUnique({
    where: { fyKey },
    select: { filedAt: true },
  });
  if (existing?.filedAt) {
    return { ok: false, error: `FY ${fyKey} is already marked filed.`, status: 409 };
  }

  const filedAt = now.toISOString();
  const { snapshot } = await buildLiveSnapshot(fy, now, filedAt);
  // TaxYearSnapshot is an interface, which TS won't treat as an index-signature JSON
  // object, hence the cast through unknown. The value is plain JSON by construction.
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
    // A first save from the home office form racing this one can also take the create
    // path; the loser hits the fyKey unique index (P2002). Retry once: the row now
    // exists, so the retry updates it.
    if (!isPrismaError(err, "P2002")) throw err;
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
    return { ok: false, error: `FY ${fyKey} isn't marked filed.`, status: 409 };
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
    if (!isPrismaError(err, "P2025")) throw err;
    return { ok: false, error: `FY ${fyKey} has no tax record.`, status: 404 };
  }
  return { ok: true, filedAt: null };
}
