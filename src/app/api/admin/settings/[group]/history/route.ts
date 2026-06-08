// src/app/api/admin/settings/[group]/history/route.ts
/**
 * @file route.ts
 * @description Admin read of the change history for one settings group. Returns
 * the most recent `SettingAudit` rows (newest first) with the set of top-level
 * keys that changed in each, plus the raw post-change value so the panel can
 * load a prior version back into the editor for review + re-save.
 */

import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import type { SettingsGroup } from "@/shared/lib/settings/types";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GROUPS = Object.keys(DEFAULT_SETTINGS) as SettingsGroup[];

/** How many history rows to surface per group. */
const HISTORY_LIMIT = 20;

/**
 * Narrows a raw route param to a known settings group.
 * @param value - Raw `[group]` path segment.
 * @returns The group when valid, else null.
 */
function asGroup(value: string): SettingsGroup | null {
  return (GROUPS as string[]).includes(value) ? (value as SettingsGroup) : null;
}

/**
 * Lists the top-level keys whose JSON differs between two stored group values.
 * A null `oldJson` (the first write) yields an empty list - the panel labels
 * that row as the first saved version instead.
 * @param oldJson - Previous group JSON, or null on the first write.
 * @param newJson - New group JSON.
 * @returns Sorted list of changed top-level keys.
 */
function changedKeys(oldJson: string | null, newJson: string): string[] {
  if (oldJson === null) return [];
  let oldObj: Record<string, unknown>;
  let newObj: Record<string, unknown>;
  try {
    oldObj = JSON.parse(oldJson) as Record<string, unknown>;
    newObj = JSON.parse(newJson) as Record<string, unknown>;
  } catch {
    return [];
  }
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  return [...keys].filter((k) => JSON.stringify(oldObj[k]) !== JSON.stringify(newObj[k])).sort();
}

/**
 * GET /api/admin/settings/[group]/history - recent audit rows for one group.
 * @param request - Incoming request (admin-gated).
 * @param ctx - Route context carrying the `[group]` param.
 * @param ctx.params - Promised route params.
 * @returns JSON `{ ok, entries }` or an error.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ group: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const group = asGroup((await params).group);
  if (!group) return NextResponse.json({ error: "Unknown settings group" }, { status: 404 });

  const rows = await prisma.settingAudit.findMany({
    where: { group },
    orderBy: { changedAt: "desc" },
    take: HISTORY_LIMIT,
  });

  const entries = rows.map((r) => ({
    id: r.id,
    changedAt: r.changedAt.toISOString(),
    isInitial: r.oldValue === null,
    changedKeys: changedKeys(r.oldValue, r.newValue),
    value: r.newValue,
  }));

  return NextResponse.json({ ok: true, entries });
}
