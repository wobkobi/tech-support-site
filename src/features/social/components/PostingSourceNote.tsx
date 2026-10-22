"use client";
// src/features/social/components/PostingSourceNote.tsx
// The line above a posting naming the content item it came from, and whether it still follows it.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { postHref } from "@/features/social/lib/links";
import type { PostingSource } from "@/features/social/lib/open-post";
import type { SocialPostStatus } from "@/features/social/lib/post-row";
import Link from "next/link";
import type React from "react";

/**
 * Posting source note.
 * @param props - Component props.
 * @param props.source - The content item.
 * @param props.status - The posting's status.
 * @param props.detached - Whether it was edited by hand.
 * @param props.relinking - Whether Re-link is running.
 * @param props.onRelink - Copies the item over the posting again.
 * @returns The note.
 */
export function PostingSourceNote({
  source,
  status,
  detached,
  relinking,
  onRelink,
}: {
  source: PostingSource;
  status: SocialPostStatus;
  detached: boolean;
  relinking: boolean;
  onRelink: () => void;
}): React.ReactElement {
  const lined = status === "draft" || status === "scheduled";
  const item = (
    <Link
      href={postHref({ id: source.id, isContent: true })}
      className="font-semibold text-russian-violet underline-offset-2 hover:underline"
    >
      {source.name || "Untitled"}
    </Link>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-admin-border bg-admin-surface px-4 py-3 text-sm text-admin-text">
      <p>
        Made from the content item {item}.{" "}
        {!lined
          ? null
          : detached
            ? "You edited it by hand, so changes to the item don't reach it."
            : "Changes to the item reach it until you edit it here."}
      </p>
      {lined && detached && (
        <AdminButton size="xs" variant="outline" busy={relinking} onClick={onRelink}>
          Re-link
        </AdminButton>
      )}
    </div>
  );
}
