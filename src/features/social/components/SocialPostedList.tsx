"use client";
// src/features/social/components/SocialPostedList.tsx
// The Posted fold on the Social page: posts that are done (up, or taken down), each with
// its outcome on every platform and a button to open it for take-down, retry or copying.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { LEDGER_LINK_CLS } from "@/features/business/components/ledger-classes";
import { dateLabel, firstLine } from "@/features/social/components/social-list-helpers";
import { POST_STATUS_PILL } from "@/features/social/lib/post-display";
import type { SocialPostRow } from "@/features/social/lib/post-row";
import { PLATFORM_LABEL, type SocialPlatformKey } from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { FaChevronDown } from "react-icons/fa6";

/**
 * Posted fold.
 * @param props - Component props.
 * @param props.posted - Finished posts, newest first.
 * @param props.open - Whether the fold is open.
 * @param props.onToggle - Records the fold's new open state.
 * @param props.openId - Id of the post open in the composer.
 * @param props.isBusy - Whether a post is being loaded.
 * @param props.onOpen - Opens a post in the composer.
 * @returns Details element.
 */
export function SocialPostedList({
  posted,
  open,
  onToggle,
  openId,
  isBusy,
  onOpen,
}: {
  posted: SocialPostRow[];
  open: boolean;
  onToggle: (open: boolean) => void;
  openId: string | null;
  isBusy: (key: string) => boolean;
  onOpen: (id: string) => void;
}): React.ReactElement {
  return (
    <details
      open={open}
      onToggle={(e) => onToggle(e.currentTarget.open)}
      className="group rounded-lg border border-admin-border bg-admin-surface"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-lg font-extrabold text-admin-text">
        <span>
          Posted
          {posted.length > 0 && (
            <span className="ml-1.5 text-base font-normal text-admin-muted">{posted.length}</span>
          )}
        </span>
        <FaChevronDown
          aria-hidden
          className="size-3 text-admin-muted transition-[rotate] group-open:rotate-180"
        />
      </summary>
      {posted.length === 0 ? (
        <EmptyState title="Nothing posted yet." className="border-t border-admin-border" />
      ) : (
        <ul className="flex flex-col divide-y divide-admin-border border-t border-admin-border">
          {posted.map((row) => (
            <PostedRow
              key={row.id}
              row={row}
              current={row.id === openId}
              busy={isBusy(row.id)}
              onOpen={() => onOpen(row.id)}
            />
          ))}
        </ul>
      )}
    </details>
  );
}

/**
 * One post in the Posted list: its outcome on each platform, with links to the live
 * copies, and a button to open it for take-down, retry or duplicating.
 * @param props - Component props.
 * @param props.row - Post row.
 * @param props.current - Whether it's open in the composer.
 * @param props.busy - Whether it's being opened.
 * @param props.onOpen - Opens it in the composer.
 * @returns Row element.
 */
function PostedRow({
  row,
  current,
  busy,
  onOpen,
}: {
  row: SocialPostRow;
  current: boolean;
  busy: boolean;
  onOpen: () => void;
}): React.ReactElement {
  const pill = POST_STATUS_PILL[row.status];
  const outcomes = row.targets.filter((t) => t.enabled && t.status !== "skipped");
  return (
    <li
      className={cn(
        "flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        current && "bg-russian-violet/5",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-admin-text">{row.name || "Untitled"}</span>
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
        </div>
        <p className="truncate text-sm text-admin-text-secondary">
          {firstLine(row.body) || <span className="italic">No text</span>}
        </p>
        <p className="text-sm text-admin-muted">{dateLabel(row)}</p>
        {outcomes.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {outcomes.map((t) => {
              const label = PLATFORM_LABEL[t.platform as SocialPlatformKey] ?? t.platform;
              return (
                <li key={t.platform}>
                  {t.status === "posted" && t.permalink ? (
                    <a
                      href={t.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className={LEDGER_LINK_CLS}
                    >
                      See it on {label}
                    </a>
                  ) : t.status === "posted" ? (
                    <span className="text-admin-text">{label}: posted</span>
                  ) : t.status === "removed" ? (
                    <span className="text-admin-muted">{label}: taken down</span>
                  ) : t.status === "failed" ? (
                    <span className="text-coquelicot-600">
                      {label}: {t.error ?? "failed"}
                    </span>
                  ) : (
                    <span className="text-admin-muted">{label}: still going</span>
                  )}
                  {t.status === "posted" && t.error && (
                    <span className="text-coquelicot-600"> (couldn&apos;t take it down)</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <AdminButton
        size="sm"
        variant="secondary"
        busy={busy}
        aria-current={current ? "true" : undefined}
        disabled={current}
        onClick={onOpen}
        className="shrink-0 self-start sm:self-center"
      >
        {current ? "Open above" : "Open"}
      </AdminButton>
    </li>
  );
}
