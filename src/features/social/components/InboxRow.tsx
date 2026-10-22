// src/features/social/components/InboxRow.tsx
// One inbox thread as a list shows it, used by the Inbox and the Overview's New comments and
// messages card, and a review's stars.

import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { AppIcons } from "@/features/social/components/AppIcons";
import type { InboxThreadRow } from "@/features/social/lib/inbox/inbox-data.server";
import { dmAppLabel, listWhen } from "@/features/social/lib/inbox/map";
import { PLATFORM_LABEL } from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";
import { FaStar } from "react-icons/fa6";

/**
 * A review's stars.
 * @param props - Component props.
 * @param props.rating - Stars, 1 to 5.
 * @returns The stars, read out as "4 of 5 stars".
 */
export function Stars({ rating }: { rating: number }): React.ReactElement {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      role="img"
      aria-label={`${rating} of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <FaStar
          key={n}
          aria-hidden
          className={cn("size-3.5", n <= rating ? "text-amber-500" : "text-seasalt-300")}
        />
      ))}
    </span>
  );
}

/**
 * One thread in a list.
 * @param props - Component props.
 * @param props.row - The thread.
 * @param props.href - Its address with it open.
 * @param props.open - Whether it's the open one.
 * @param props.nowMs - When the page loaded, as epoch ms.
 * @returns The row.
 */
export function InboxRow({
  row,
  href,
  open,
  nowMs,
}: {
  row: InboxThreadRow;
  href: string;
  open: boolean;
  nowMs: number;
}): React.ReactElement {
  const conversation = row.kind === "conversation";
  const where = conversation
    ? `${dmAppLabel(row.platform)} message`
    : row.kind === "review"
      ? "Google review"
      : row.postName
        ? `On ${row.postName}`
        : `On your ${PLATFORM_LABEL[row.platform]} post`;
  return (
    <li className="border-b border-admin-border last:border-b-0">
      <Link
        href={href}
        scroll={false}
        aria-current={open ? "true" : undefined}
        className={cn(
          "flex gap-3 px-4 py-3 transition-colors",
          open ? "bg-moonstone-50" : "hover:bg-admin-bg",
        )}
      >
        <span className="mt-2 flex w-2.5 shrink-0 justify-center">
          {row.unread && (
            <span className="size-2.5 rounded-full bg-coquelicot-600">
              <span className="sr-only">Unread.</span>
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            <AppIcons platforms={[row.platform]} className="shrink-0 self-center" />
            <span
              className={cn(
                "min-w-0 truncate text-base text-admin-text",
                row.unread ? "font-bold" : "font-semibold",
              )}
            >
              {row.author}
            </span>
            <span className="ml-auto shrink-0 text-sm text-admin-muted">
              {listWhen(row.lastActivityAt, nowMs)}
            </span>
          </span>
          {row.rating !== null && <Stars rating={row.rating} />}
          <span className="line-clamp-2 text-base wrap-break-word text-admin-text-secondary">
            {row.snippet}
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-admin-muted">
            <span className="min-w-0 truncate">{where}</span>
            {row.replies > 0 && (
              <span>
                {conversation
                  ? row.replies === 1
                    ? "1 message"
                    : `${row.replies} messages`
                  : row.replies === 1
                    ? "1 reply"
                    : `${row.replies} replies`}
              </span>
            )}
            {row.needsReply && <StatusPill tone="info">Needs a reply</StatusPill>}
            {row.hidden && <StatusPill tone="warning">Hidden</StatusPill>}
          </span>
        </span>
        {row.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- Blob picture of unknown size, which next/image needs up front.
          <img
            src={row.imageUrl}
            alt=""
            className="size-12 shrink-0 self-center rounded-md object-cover"
          />
        )}
      </Link>
    </li>
  );
}
