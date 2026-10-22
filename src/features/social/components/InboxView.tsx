"use client";
// src/features/social/components/InboxView.tsx
// Social Inbox: Inbox and Archive, the apps on show, Check now and Mark all read, why an app's
// comments aren't coming through, the filters with their counts, search, the threads, and the
// open thread beside them (on its own on a phone).

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Card } from "@/features/admin/components/ui/Card";
import {
  SEGMENTED_GROUP_CLS,
  segmentedButtonClass,
} from "@/features/admin/components/ui/chip-classes";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { ListToolbar } from "@/features/admin/components/ui/ListToolbar";

import { StickyList } from "@/features/admin/components/ui/StickyList";
import { StickyRail } from "@/features/admin/components/ui/StickyRail";
import { useToast } from "@/features/admin/components/ui/Toast";
import { timeAgo } from "@/features/business/lib/calculator-draft";
import { callApi } from "@/features/mailing/lib/api-client";
import { InboxRow } from "@/features/social/components/InboxRow";
import { InboxThread } from "@/features/social/components/InboxThread";
import { announceInboxChange } from "@/features/social/hooks/use-inbox-unread";
import type { InboxData } from "@/features/social/lib/inbox/inbox-data.server";
import {
  INBOX_FILTER_LABEL,
  INBOX_FILTERS,
  inboxHref,
  type InboxApp,
  type InboxQuery,
} from "@/features/social/lib/inbox/map";
import { SOCIAL_OVERVIEW_PATH } from "@/features/social/lib/links";
import { PLATFORM_LABEL, SOCIAL_PLATFORMS } from "@/features/social/lib/validate";
import { Notice } from "@/shared/components/Notice";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { FaArrowsRotate, FaMagnifyingGlass } from "react-icons/fa6";

/**
 * The Inbox page.
 * @param props - Component props.
 * @param props.data - What the server loaded.
 * @param props.query - The address's tab, filter, app and words.
 * @param props.now - When the page loaded, as ISO, so times read the same on both sides.
 * @param props.canSuggest - Whether an AI provider is set up for Suggest a reply.
 * @param props.reviewTemplateId - The Post maker's review template, if there is one.
 * @returns The inbox.
 */
export function InboxView({
  data,
  query,
  now,
  canSuggest,
  reviewTemplateId,
}: {
  data: InboxData;
  query: InboxQuery;
  now: string;
  canSuggest: boolean;
  reviewTemplateId: string | null;
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);
  const [marking, setMarking] = useState(false);
  const [words, setWords] = useState(query.q);
  const nowMs = Date.parse(now);
  const openId = data.open?.id ?? null;
  const apps: InboxApp[] = ["all", ...SOCIAL_PLATFORMS.filter((p) => data.setUp.includes(p))];
  const checked = data.ranAt ? timeAgo(Date.parse(data.ranAt), nowMs) : null;
  const searching = query.q !== "" || query.filter !== "all";

  /** Reads new comments and reviews now, then reloads the page's data. */
  async function checkNow(): Promise<void> {
    setChecking(true);
    const res = await callApi<{ result: Record<string, number | string> }>(
      "/api/admin/social/inbox/refresh",
      "POST",
      {},
    );
    setChecking(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    const failed = Object.values(res.result).some((v) => typeof v === "string");
    toast(failed ? "Checked, but an app's read failed. See the note above the list." : "Checked.", {
      tone: failed ? "warning" : "success",
    });
    announceInboxChange();
    router.refresh();
  }

  /** Marks every unread thread read, for the app on show or all of them. */
  async function markAllRead(): Promise<void> {
    setMarking(true);
    const res = await callApi<{ count: number }>("/api/admin/social/inbox/read-all", "POST", {
      ...(query.app === "all" ? {} : { platform: query.app }),
    });
    setMarking(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    toast(res.count === 1 ? "1 thread marked read." : `${res.count} threads marked read.`, {
      tone: "success",
    });
    announceInboxChange();
    router.refresh();
  }

  /**
   * Finds the words typed in the search box.
   * @param event - The form's submit.
   */
  function search(event: React.FormEvent): void {
    event.preventDefault();
    router.push(inboxHref({ ...query, q: words.trim() }), { scroll: false });
  }

  const list = (
    <StickyList
      toolbar={
        <ListToolbar
          search={
            <form role="search" onSubmit={search} className="flex gap-2">
              <label htmlFor="inbox-search" className="sr-only">
                Find words or a name
              </label>
              <AdminInput
                id="inbox-search"
                type="search"
                value={words}
                onChange={(e) => setWords(e.target.value)}
                placeholder="Find words or a name"
                maxLength={100}
                className="min-w-0 flex-1"
              />
              <AdminButton type="submit" variant="outline" aria-label="Find">
                <FaMagnifyingGlass aria-hidden className="size-3.5" />
              </AdminButton>
            </form>
          }
          filters={
            <nav aria-label="Threads to show" className={cn(SEGMENTED_GROUP_CLS, "flex-wrap")}>
              {INBOX_FILTERS.map((f) => (
                <Link
                  key={f}
                  href={inboxHref({ ...query, filter: f })}
                  scroll={false}
                  aria-current={f === query.filter ? "page" : undefined}
                  className={cn(
                    segmentedButtonClass(f === query.filter),
                    "inline-flex items-center",
                  )}
                >
                  {INBOX_FILTER_LABEL[f]}
                  {query.tab === "inbox" && (
                    <span
                      className={cn(
                        "ml-1.5 font-normal",
                        f === query.filter ? "text-white/80" : "text-admin-muted",
                      )}
                    >
                      {data.counts[f]}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
          }
          count={data.threads.length === 1 ? "1 thread" : `${data.threads.length} threads`}
        />
      }
    >
      {data.threads.length === 0 ? (
        <EmptyState
          title={
            searching
              ? "Nothing matches"
              : query.tab === "archive"
                ? "Nothing archived"
                : "No comments or reviews yet"
          }
          body={
            searching
              ? "Try other words, or show every thread."
              : query.tab === "archive"
                ? "Threads you archive move here, and come back to the inbox when someone writes again."
                : "New comments on your posts and new Google reviews show here once they're read."
          }
          action={
            searching ? (
              <AdminButton variant="outline" href={inboxHref({ ...query, filter: "all", q: "" })}>
                Show every thread
              </AdminButton>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-xl border border-admin-border bg-admin-surface">
          {data.threads.map((t) => (
            <InboxRow
              key={t.id}
              row={t}
              href={inboxHref(query, t.id)}
              open={t.id === openId}
              nowMs={nowMs}
            />
          ))}
        </ul>
      )}
    </StickyList>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <nav aria-label="Inbox or archive" className={SEGMENTED_GROUP_CLS}>
          {(["inbox", "archive"] as const).map((tab) => (
            <Link
              key={tab}
              href={inboxHref({ ...query, tab })}
              aria-current={tab === query.tab ? "page" : undefined}
              className={cn(segmentedButtonClass(tab === query.tab), "inline-flex items-center")}
            >
              {tab === "inbox" ? "Inbox" : "Archive"}
              {tab === "inbox" && data.unread > 0 && (
                <span className="ml-1.5 rounded-full bg-coquelicot-600 px-1.5 text-sm leading-5 font-bold text-white">
                  {data.unread}
                  <span className="sr-only"> unread</span>
                </span>
              )}
            </Link>
          ))}
        </nav>
        {apps.length > 2 && (
          <nav aria-label="Apps to show" className={cn(SEGMENTED_GROUP_CLS, "flex-wrap")}>
            {apps.map((a) => (
              <Link
                key={a}
                href={inboxHref({ ...query, app: a })}
                aria-current={a === query.app ? "page" : undefined}
                className={cn(segmentedButtonClass(a === query.app), "inline-flex items-center")}
              >
                {a === "all" ? "All apps" : PLATFORM_LABEL[a]}
              </Link>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
          <p className="text-sm text-admin-text-secondary" aria-live="polite">
            {checking ? "Checking..." : checked ? `Checked ${checked}` : "Not checked yet"}
          </p>
          <AdminButton variant="outline" onClick={() => void checkNow()} disabled={checking}>
            <FaArrowsRotate aria-hidden className={cn("size-3.5", checking && "animate-spin")} />{" "}
            Check now
          </AdminButton>
          <AdminButton
            variant="outline"
            busy={marking}
            disabled={data.unread === 0}
            onClick={() => void markAllRead()}
          >
            Mark all read
          </AdminButton>
        </div>
      </div>

      {data.setUp.length === 0 && (
        <Notice tone="warn" onGrey>
          No apps are connected, so there&apos;s nothing to read.{" "}
          <Link href={SOCIAL_OVERVIEW_PATH} className="font-semibold underline">
            See the set-up steps
          </Link>
          .
        </Notice>
      )}
      {SOCIAL_PLATFORMS.filter((p) => data.errors[p]).map((p) => (
        <Notice key={p} tone="warn" onGrey>
          <span className="font-semibold">{PLATFORM_LABEL[p]}:</span> {data.errors[p]}
        </Notice>
      ))}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className={cn(data.open && "hidden lg:block")}>{list}</div>
        <StickyRail className={cn(!data.open && "hidden lg:block")}>
          {data.open ? (
            <InboxThread
              key={data.open.id}
              thread={data.open}
              closeHref={inboxHref(query)}
              now={now}
              canSuggest={canSuggest}
              reviewTemplateId={reviewTemplateId}
            />
          ) : (
            <Card>
              <p className="text-base text-admin-text-secondary">
                Pick a thread to read it and reply.
              </p>
            </Card>
          )}
        </StickyRail>
      </div>
    </div>
  );
}
