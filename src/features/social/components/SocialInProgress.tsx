"use client";
// src/features/social/components/SocialInProgress.tsx
// "In progress" chips on the Social page: drafts, scheduled posts and posts stuck partway,
// each opening in the composer.

import { chipStatus, firstLine } from "@/features/social/components/social-list-helpers";
import type { SocialPostRow } from "@/features/social/lib/post-row";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * In-progress list.
 * @param props - Component props.
 * @param props.rows - Unfinished posts.
 * @param props.openId - Id of the post open in the composer.
 * @param props.isBusy - Whether a post is being loaded.
 * @param props.onOpen - Opens a post in the composer.
 * @returns Section element.
 */
export function SocialInProgress({
  rows,
  openId,
  isBusy,
  onOpen,
}: {
  rows: SocialPostRow[];
  openId: string | null;
  isBusy: (key: string) => boolean;
  onOpen: (id: string) => void;
}): React.ReactElement {
  return (
    <section aria-labelledby="social-in-progress" className="flex flex-col gap-2">
      <h2 id="social-in-progress" className="text-sm font-bold text-admin-text">
        In progress
      </h2>
      <ul className="flex flex-wrap gap-2">
        {rows.map((r) => {
          const current = r.id === openId;
          const status = chipStatus(r);
          return (
            <li key={r.id} className="w-full sm:w-64">
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                aria-busy={isBusy(r.id)}
                onClick={() => onOpen(r.id)}
                className={cn(
                  "flex w-full flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors",
                  current
                    ? "border-russian-violet bg-russian-violet/10"
                    : "border-admin-border bg-admin-surface hover:border-russian-violet/50",
                  isBusy(r.id) && "opacity-60",
                )}
              >
                <span className="w-full truncate text-sm font-semibold text-admin-text">
                  {r.name || "Untitled"}
                </span>
                <span className="w-full truncate text-sm text-admin-text-secondary">
                  {firstLine(r.body) || <span className="italic">No text yet</span>}
                </span>
                <span className={cn("text-sm", status.className)}>{status.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
