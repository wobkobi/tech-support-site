// src/features/business/lib/task-taxonomy.server.ts
// Renames a task-template tag (device or action) across every row that uses it - the safe
// way to fix a drifted or misspelt tag, since clearing one is permanent (parse-job may only
// reuse tags from the live vocabulary these fields build). A rename that collides with an
// existing (device, action) pair MERGES rather than silently shadowing a row.
//
// Tags are case-insensitive identities (see task-taxonomy.ts), so a case-only rename is the
// supported fix for a split spelling and every path below has to survive `from` and `to`
// matching the same rows.

import { composeDescription } from "@/features/business/lib/business";
import type { TaxonomyAxis } from "@/features/business/lib/task-taxonomy";
import { prisma } from "@/shared/lib/prisma";
import type { Prisma, TaskTemplate } from "@prisma/client";

/** Outcome of a rename, for the caller to report. */
export interface RenameResult {
  /** Rows whose tag was rewritten in place. */
  renamed: number;
  /** Rows folded into an existing row because the (device, action) pair collided. */
  merged: number;
}

/**
 * Renames one taxonomy tag across every task template that uses it, merging any
 * row that would collide with an existing (device, action) pair. The stored
 * description is recomposed so it never drifts from the tags it was built from.
 * Every touched row - merge survivors included - lands on the exact casing of
 * `to`, so a case-only rename settles a split spelling instead of leaving half
 * the rows on the old one.
 * @param axis - Whether to rename a device tag or an action tag.
 * @param from - The current tag value (matched case-insensitively).
 * @param to - The replacement tag value.
 * @returns Counts of rows renamed and rows merged away.
 */
export async function renameTaxonomyTag(
  axis: TaxonomyAxis,
  from: string,
  to: string,
): Promise<RenameResult> {
  /**
   * Case-insensitive match on the axis being renamed.
   * @param value - Tag value to match.
   * @returns Where clause for that axis.
   */
  const match = (value: string): Prisma.TaskTemplateWhereInput =>
    axis === "device"
      ? { device: { equals: value, mode: "insensitive" } }
      : { action: { equals: value, mode: "insensitive" } };

  // One query for both halves. Two would alias each other on a case-only rename -
  // "Pc" and "PC" match the same rows - and a row folded away early in the pass
  // would still look like a live merge target later on.
  const affected = await prisma.taskTemplate.findMany({
    where: { OR: [match(from), match(to)] },
  });

  const fromLower = from.toLowerCase();
  const moving = affected.filter((row) => (row[axis] ?? "").toLowerCase() === fromLower);
  if (moving.length === 0) return { renamed: 0, merged: 0 };

  // Once the rename lands every row in play sits on `to`, so the OTHER axis alone
  // decides a collision. Rows already parked on the target seed the map; rows
  // renamed during this pass join it, so two sources folding onto one target
  // collapse instead of recreating the duplicate.
  const otherAxis: TaxonomyAxis = axis === "device" ? "action" : "device";
  /**
   * Collision key for a row: the axis NOT being renamed, lowercased.
   * @param row - Template row to key.
   * @returns The other axis' value, lowercased.
   */
  const pairKey = (row: TaskTemplate): string => (row[otherAxis] ?? "").toLowerCase();
  const movingIds = new Set(moving.map((row) => row.id));
  const settled = new Map<string, TaskTemplate>();
  for (const row of affected) {
    if (!movingIds.has(row.id)) settled.set(pairKey(row), row);
  }

  let renamed = 0;
  let merged = 0;

  for (const row of moving) {
    const key = pairKey(row);
    const twin = settled.get(key);

    if (twin) {
      const kept = await prisma.taskTemplate.update({
        where: { id: twin.id },
        data: {
          usageCount: twin.usageCount + row.usageCount,
          // Normalise the survivor too, or a case-only rename leaves the old
          // casing standing on exactly the rows it was meant to fix.
          ...renameData(axis, to, twin),
        },
      });
      await prisma.taskTemplate.delete({ where: { id: row.id } });
      settled.set(key, kept);
      merged++;
      continue;
    }

    const updated = await prisma.taskTemplate.update({
      where: { id: row.id },
      data: renameData(axis, to, row),
    });
    settled.set(key, updated);
    renamed++;
  }

  return { renamed, merged };
}

/**
 * Builds the update payload that moves one row onto a tag, recomposing the
 * description from the tag pair the row will carry.
 * @param axis - Which axis the rename targets.
 * @param to - The replacement tag value.
 * @param row - The row being moved.
 * @returns Prisma update data for the renamed axis and the description.
 */
function renameData(
  axis: TaxonomyAxis,
  to: string,
  row: TaskTemplate,
): Prisma.TaskTemplateUpdateInput {
  const device = axis === "device" ? to : row.device;
  const action = axis === "action" ? to : row.action;
  // Templates carry no details; the description is purely device + action.
  const description = composeDescription(device, action, null) || row.description;
  return axis === "device" ? { device: to, description } : { action: to, description };
}
