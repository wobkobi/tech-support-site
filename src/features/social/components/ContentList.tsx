"use client";
// src/features/social/components/ContentList.tsx
// The Content tab: every content item with its captions, recycling and postings so far.

import {
  ROW_CLS,
  STICKY_THEAD_CLS,
  TABLE_CLS,
  TABLE_SCROLL_CLS,
  TBODY_CLS,
  TD_CLS,
  THEAD_CLS,
  TH_CLS,
} from "@/features/admin/components/ui/admin-table";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import type { ContentListRow } from "@/features/social/lib/content-row";
import { postHref } from "@/features/social/lib/links";
import type { SocialPostRow } from "@/features/social/lib/post-row";
import { captionsOf } from "@/features/social/lib/postings-core";
import { cn } from "@/shared/lib/cn";
import { formatDateShort, formatDateTimeShort } from "@/shared/lib/date-format";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { FaPlus } from "react-icons/fa6";

/**
 * A content item's recycling in a few words.
 * @param item - The item.
 * @returns Plain words.
 */
function recyclingOf(item: SocialPostRow): string {
  const limits = [
    item.maxPosts && `up to ${item.maxPosts === 1 ? "once" : `${item.maxPosts} times`}`,
    item.expiresAt && `until ${formatDateShort(item.expiresAt)}`,
  ].filter(Boolean);
  const base = item.recycle ? "Again and again" : "Once";
  return limits.length > 0 ? `${base}, ${limits.join(", ")}` : base;
}

/**
 * Content list.
 * @param props - Component props.
 * @param props.rows - Every content item, last edited first.
 * @returns List element.
 */
export function ContentList({ rows }: { rows: ContentListRow[] }): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);

  /** Makes a blank content item and opens it. */
  async function create(): Promise<void> {
    setCreating(true);
    const res = await callApi<{ item: SocialPostRow }>("/api/admin/social/content", "POST", {
      source: "blank",
    });
    if (!res.ok) {
      setCreating(false);
      toast(res.error, { tone: "error" });
      return;
    }
    router.push(postHref(res.item));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-admin-muted">
          Content items are posts you&apos;ll use again. Give one a few captions and it takes the
          next each time it goes out. Use Save to content on any post to add it here.
        </p>
        <AdminButton busy={creating} onClick={() => void create()}>
          <FaPlus aria-hidden /> New content item
        </AdminButton>
      </div>
      <Card padding="none">
        {rows.length === 0 ? (
          <EmptyState title="No content yet. Make one, or save a post to content." />
        ) : (
          <div className={TABLE_SCROLL_CLS}>
            <table className={TABLE_CLS}>
              <thead className={cn(THEAD_CLS, STICKY_THEAD_CLS)}>
                <tr>
                  <th className={TH_CLS}>Name</th>
                  <th className={TH_CLS}>Captions</th>
                  <th className={TH_CLS}>Posts</th>
                  <th className={TH_CLS}>Postings</th>
                  <th className={TH_CLS}>Last posted</th>
                  <th className={TH_CLS}>Next</th>
                </tr>
              </thead>
              <tbody className={TBODY_CLS}>
                {rows.map(({ item, stats, spent }) => (
                  <tr key={item.id} className={ROW_CLS}>
                    <td className={TD_CLS}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={postHref(item)}
                          className="font-semibold text-admin-text underline-offset-2 hover:underline"
                        >
                          {item.name || "Untitled"}
                        </Link>
                        {spent && <StatusPill tone="neutral">Finished</StatusPill>}
                      </div>
                    </td>
                    <td className={TD_CLS}>{captionsOf(item).filter((c) => c.trim()).length}</td>
                    <td className={cn(TD_CLS, "whitespace-nowrap")}>{recyclingOf(item)}</td>
                    <td className={TD_CLS}>{stats.count}</td>
                    <td className={cn(TD_CLS, "whitespace-nowrap")}>
                      {stats.lastPostedAt ? formatDateShort(stats.lastPostedAt) : "-"}
                    </td>
                    <td className={cn(TD_CLS, "whitespace-nowrap")}>
                      {stats.nextAt ? formatDateTimeShort(stats.nextAt) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
