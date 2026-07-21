// src/features/business/lib/task-taxonomy.ts
// Renames a task-template tag (device or action) across every row that uses
// it - the safe way to fix a drifted or misspelt tag. Clearing a tag instead
// is permanent: parse-job may only reuse tags in the live vocabulary, which is
// built from these very fields. A rename can collide with an existing
// (device, action) pair - findTemplateByTags would silently shadow one row -
// so a collision MERGES: usage counts add up and the duplicate row is removed.

import { composeDescription } from "@/features/business/lib/business";
import { prisma } from "@/shared/lib/prisma";

/** Which tag axis to rename. */
export type TaxonomyAxis = "device" | "action";

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
  const moving = await prisma.taskTemplate.findMany({
    where: { [axis]: { equals: from, mode: "insensitive" } },
  });
  if (moving.length === 0) return { renamed: 0, merged: 0 };

  // Rows already carrying the target tag - the merge candidates. Rows renamed
  // during this pass are appended, so two sources folding onto one target still
  // collapse instead of recreating the duplicate.
  const settled = await prisma.taskTemplate.findMany({
    where: { [axis]: { equals: to, mode: "insensitive" } },
  });

  let renamed = 0;
  let merged = 0;

  for (const row of moving) {
    // The other axis has to match too - a pair only collides when BOTH agree.
    const otherAxis: TaxonomyAxis = axis === "device" ? "action" : "device";
    const twin = settled.find(
      (s) =>
        s.id !== row.id &&
        (s[otherAxis] ?? "").toLowerCase() === (row[otherAxis] ?? "").toLowerCase(),
    );

    if (twin) {
      await prisma.taskTemplate.update({
        where: { id: twin.id },
        data: { usageCount: twin.usageCount + row.usageCount },
      });
      await prisma.taskTemplate.delete({ where: { id: row.id } });
      twin.usageCount += row.usageCount;
      merged++;
      continue;
    }

    const device = axis === "device" ? to : row.device;
    const action = axis === "action" ? to : row.action;
    const updated = await prisma.taskTemplate.update({
      where: { id: row.id },
      data: {
        [axis]: to,
        // Templates carry no details; the description is purely device + action.
        description: composeDescription(device, action, null) || row.description,
      },
    });
    settled.push(updated);
    renamed++;
  }

  return { renamed, merged };
}
