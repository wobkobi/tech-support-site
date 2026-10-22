"use client";
// src/features/social/components/ContentPostings.tsx
// A content item's postings, newest first: how each went, when, and which caption it used.

import { Card } from "@/features/admin/components/ui/Card";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { postHref } from "@/features/social/lib/links";
import { POST_STATUS_PILL } from "@/features/social/lib/post-display";
import type { SocialPostRow } from "@/features/social/lib/post-row";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";

/**
 * When a posting went out, goes out, or was last changed.
 * @param p - Posting.
 * @returns Plain words.
 */
function whenOf(p: SocialPostRow): string {
  if (p.postedAt) return `Went out ${formatDateTimeShort(p.postedAt)}`;
  if (p.status === "scheduled" && p.scheduledAt) {
    return `Goes out ${formatDateTimeShort(p.scheduledAt)}`;
  }
  return `Last changed ${formatDateTimeShort(p.updatedAt)}`;
}

/**
 * Postings card.
 * @param props - Component props.
 * @param props.postings - The item's postings, newest first.
 * @returns Card element.
 */
export function ContentPostings({ postings }: { postings: SocialPostRow[] }): React.ReactElement {
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-base font-bold text-admin-text">Postings</h3>
          <p className="text-sm text-admin-muted">
            Each time this goes out, a posting is made. Lined-up postings follow your changes here
            until you edit one by hand.
          </p>
        </div>
        {postings.length === 0 ? (
          <p className="text-sm text-admin-muted">None yet. Post now or schedule a posting.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-admin-border">
            {postings.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <StatusPill tone={POST_STATUS_PILL[p.status].tone}>
                  {POST_STATUS_PILL[p.status].label}
                </StatusPill>
                <span className="text-admin-text">{whenOf(p)}</span>
                <span className="text-admin-muted">Caption {(p.captionIndex ?? 0) + 1}</span>
                {p.detached && <span className="text-admin-muted">Edited by hand</span>}
                <Link
                  href={postHref(p)}
                  className="ml-auto font-semibold text-russian-violet underline-offset-2 hover:underline"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
