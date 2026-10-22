"use client";
// src/features/social/components/SocialTagFilter.tsx
// Tag filter chips over the Social page's post lists, with the way into Manage tags.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { adminChipClass } from "@/features/admin/components/ui/chip-classes";
import { TAG_COLOURS, type SocialTagRow } from "@/features/social/lib/tags";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Tag filter row.
 * @param props - Component props.
 * @param props.tags - Every tag, A to Z.
 * @param props.countOf - How many posts (not presets) carry a tag.
 * @param props.value - The tag filtered on, or null for every post.
 * @param props.onChange - Called with the tag picked, or null for All posts.
 * @param props.onManage - Opens Manage tags.
 * @returns Section element.
 */
export function SocialTagFilter({
  tags,
  countOf,
  value,
  onChange,
  onManage,
}: {
  tags: SocialTagRow[];
  countOf: (id: string) => number;
  value: string | null;
  onChange: (id: string | null) => void;
  onManage: () => void;
}): React.ReactElement {
  return (
    <section aria-labelledby="social-tag-filter" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="social-tag-filter" className="text-sm font-bold text-admin-text">
          Show posts tagged
        </h2>
        <AdminButton size="xs" variant="ghost" onClick={onManage}>
          Manage tags
        </AdminButton>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={value === null}
          onClick={() => onChange(null)}
          className={adminChipClass(value === null)}
        >
          All posts
        </button>
        {tags.map((t) => {
          const active = value === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? null : t.id)}
              className={cn(adminChipClass(active), "inline-flex items-center gap-1.5")}
            >
              <span
                aria-hidden
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  TAG_COLOURS[t.colour].dot,
                  active && "ring-2 ring-white",
                )}
              />
              {t.name}
              <span className={cn("font-normal", active ? "text-white/80" : "text-admin-muted")}>
                {countOf(t.id)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
