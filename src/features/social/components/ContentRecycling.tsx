"use client";
// src/features/social/components/ContentRecycling.tsx
// A content item's recycling settings - more than once, how many times, last day - with how
// its postings so far.

import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Card } from "@/features/admin/components/ui/Card";
import type { ContentStatsRow } from "@/features/social/lib/content-row";
import { MAX_POSTS_LIMIT } from "@/features/social/lib/postings-core";
import { formatDateShort, formatDateTimeShort } from "@/shared/lib/date-format";
import type React from "react";
import { useId } from "react";

/** The recycling fields as the composer holds them. */
export interface RecyclingValue {
  recycle: boolean;
  /** Null for no limit. */
  maxPosts: number | null;
  /** YYYY-MM-DD, empty for no last day. */
  expiresAt: string;
}

/**
 * A line on how many postings the item has had.
 * @param stats - Its stats.
 * @returns Plain words.
 */
function historyLine(stats: ContentStatsRow): string {
  const gone =
    stats.count === 0
      ? "No postings yet."
      : `${stats.count === 1 ? "1 posting" : `${stats.count} postings`} so far${
          stats.lastPostedAt ? `, last posted ${formatDateShort(stats.lastPostedAt)}` : ""
        }.`;
  return stats.nextAt ? `${gone} Next: ${formatDateTimeShort(stats.nextAt)}.` : gone;
}

/**
 * Recycling card.
 * @param props - Component props.
 * @param props.value - The fields now.
 * @param props.onChange - Called with the fields changed.
 * @param props.stats - Its postings so far.
 * @param props.spent - Why nothing more goes out from it, or null.
 * @returns Card element.
 */
export function ContentRecycling({
  value,
  onChange,
  stats,
  spent,
}: {
  value: RecyclingValue;
  onChange: (patch: Partial<RecyclingValue>) => void;
  stats: ContentStatsRow;
  spent: string | null;
}): React.ReactElement {
  const id = useId();
  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-base font-bold text-admin-text">Recycling</h3>
          <p className="text-sm text-admin-muted">{historyLine(stats)}</p>
        </div>
        <AdminCheckbox
          checked={value.recycle}
          onChange={(recycle) => onChange({ recycle })}
          label="Post this more than once"
        />
        <p className="-mt-2 text-sm text-admin-muted">
          {value.recycle
            ? "Schedules can post it again after a break. Each time takes the next caption."
            : "Schedules post it once. You can still post it again yourself."}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <AdminField
            label="Stop after"
            htmlFor={`${id}-max`}
            hint="How many times it goes out. Leave empty for no limit."
          >
            <AdminInput
              id={`${id}-max`}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_POSTS_LIMIT}
              step={1}
              value={value.maxPosts ?? ""}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const n = Math.trunc(Number(raw));
                onChange({
                  maxPosts:
                    raw === "" || !Number.isFinite(n)
                      ? null
                      : Math.min(MAX_POSTS_LIMIT, Math.max(1, n)),
                });
              }}
            />
          </AdminField>
          <AdminField
            label="Last day to post"
            htmlFor={`${id}-last`}
            hint="Nothing goes out from it after this day. Leave empty to keep it going."
          >
            <AdminInput
              id={`${id}-last`}
              type="date"
              value={value.expiresAt}
              onChange={(e) => onChange({ expiresAt: e.target.value })}
            />
          </AdminField>
        </div>
        {spent && (
          <p className="rounded-lg border border-mustard-400 bg-mustard-50 px-3 py-2 text-sm text-admin-text">
            {spent}
          </p>
        )}
      </div>
    </Card>
  );
}
