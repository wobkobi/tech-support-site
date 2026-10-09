// src/features/business/components/tax/FiledChangesNotice.tsx
// Shown on a filed year's Tax page: every figure where a fresh calculation now differs from
// the saved snapshot, which is what an amended return would change. Also covers a snapshot
// that can't be read and the all-clear when nothing has moved.

import { formatNZD } from "@/features/business/lib/business-format";
import type { SnapshotChange } from "@/features/business/lib/tax/snapshot";
import { Notice } from "@/shared/components/Notice";
import type React from "react";

/**
 * Formats a compared value in its unit.
 * @param value - Money or kilometres.
 * @param unit - Which of the two.
 * @returns E.g. "$1,234.50" or "1,240.5 km".
 */
function formatValue(value: number, unit: SnapshotChange["unit"]): string {
  return unit === "km"
    ? `${value.toLocaleString("en-NZ", { maximumFractionDigits: 1 })} km`
    : formatNZD(value);
}

/**
 * Signed difference, live minus filed, e.g. "+$92.50" or "-$383.00".
 * @param change - The change.
 * @returns The formatted difference.
 */
function formatDifference(change: SnapshotChange): string {
  const diff = Math.round((change.live - change.filed) * 100) / 100;
  return `${diff > 0 ? "+" : ""}${formatValue(diff, change.unit)}`;
}

/**
 * Notice listing what a filed year's amendment would change.
 * @param props - Component props.
 * @param props.fyLabel - FY display label.
 * @param props.changes - Differences between the snapshot and a fresh calculation.
 * @param props.unreadable - True when the year is filed but its snapshot can't be read.
 * @returns The notice.
 */
export function FiledChangesNotice({
  fyLabel,
  changes,
  unreadable,
}: {
  fyLabel: string;
  changes: SnapshotChange[];
  unreadable: boolean;
}): React.ReactElement {
  if (unreadable) {
    return (
      <Notice tone="warn" className="mb-6">
        This year&apos;s filed figures couldn&apos;t be read, so these are fresh figures. Unfile and
        file it again to save them.
      </Notice>
    );
  }
  if (changes.length === 0) {
    return (
      <Notice tone="ok" className="mb-6">
        Live figures still match what was filed for {fyLabel}.
      </Notice>
    );
  }
  return (
    <Notice tone="warn" className="mb-6">
      <p className="font-bold">Live figures no longer match what was filed</p>
      <p className="mt-1">
        These figures have changed since {fyLabel} was filed. If the changes are right, your
        accountant would need to amend the return:
      </p>
      <ul className="mt-3 divide-y divide-admin-border">
        {changes.map((change) => (
          <li
            key={change.key}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
          >
            <span className="font-bold">{change.label}</span>
            <span className="tabular-nums">
              {formatValue(change.filed, change.unit)} filed,{" "}
              {formatValue(change.live, change.unit)} now ({formatDifference(change)})
            </span>
          </li>
        ))}
      </ul>
    </Notice>
  );
}
