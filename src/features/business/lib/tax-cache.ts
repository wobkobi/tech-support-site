// src/features/business/lib/tax-cache.ts
/**
 * @file tax-cache.ts
 * @description Per-scope cache of tax-planner inputs in the Setting table.
 */

import { prisma } from "@/shared/lib/prisma";
import type { TaxPaymentTotals } from "@/features/business/lib/tax-payments";
import type { TaxRates } from "@/features/business/lib/tax-planner";

/** How long a cached snapshot is fresh (1h trades staleness for fewer API calls). */
export const TAX_CACHE_TTL_MS = 60 * 60 * 1000;

/** Setting-table key prefix; one row per scope. */
const KEY_PREFIX = "tax-cache:";

/** Cached payload: payment totals + planner config. */
export interface CachedTaxSnapshot {
  paymentTotals: TaxPaymentTotals | null;
  rates: TaxRates;
  /** Weekly tax-account + KiwiSaver transfer amounts. */
  weeklyAmounts: { kiwiSaver: number; incomeTax: number };
  /** Auto-transfer start as ISO (Date doesn't survive JSON). */
  scheduleStartISO: string | null;
}

interface SerialisedSnapshot {
  cachedAtISO: string;
  data: CachedTaxSnapshot;
}

/**
 * Reads a cached snapshot or null if missing / older than the TTL.
 * @param scopeKey - Scope key (e.g. "all", "2026-27").
 * @returns Cached snapshot or null.
 */
export async function readCachedTaxSnapshot(scopeKey: string): Promise<CachedTaxSnapshot | null> {
  const row = await prisma.setting.findUnique({ where: { key: KEY_PREFIX + scopeKey } });
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as SerialisedSnapshot;
    const age = Date.now() - new Date(parsed.cachedAtISO).getTime();
    if (age > TAX_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch (err) {
    console.error("[tax-cache] failed to parse cached snapshot:", err);
    return null;
  }
}

/**
 * Upserts a snapshot for the given scope.
 * @param scopeKey - Scope key.
 * @param data - Snapshot to persist.
 */
export async function writeCachedTaxSnapshot(
  scopeKey: string,
  data: CachedTaxSnapshot,
): Promise<void> {
  const value = JSON.stringify({
    cachedAtISO: new Date().toISOString(),
    data,
  } as SerialisedSnapshot);
  await prisma.setting.upsert({
    where: { key: KEY_PREFIX + scopeKey },
    update: { value },
    create: { key: KEY_PREFIX + scopeKey, value },
  });
}

/** Clears every tax-cache row (used by the dashboard's `?refresh=1` path). */
export async function clearTaxCache(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: { startsWith: KEY_PREFIX } } });
}
