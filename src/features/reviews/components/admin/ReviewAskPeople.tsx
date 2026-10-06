"use client";
// src/features/reviews/components/admin/ReviewAskPeople.tsx
// "Who you can ask" on the admin reviews page: every contact, with whether a review ask
// can go to them and when they were last asked, filtered by where they stand. Each row
// sends (or re-sends) the Google-first ask by email, or composes a text for phone-only
// contacts. Opted-out people are listed so it's clear why they have no button.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ShowMoreButton } from "@/features/admin/components/ui/ShowMoreButton";
import { StatusPill, type StatusTone } from "@/features/admin/components/ui/StatusPill";
import { useShowMore } from "@/features/admin/hooks/use-show-more";
import type { AskPersonStatus } from "@/features/reviews/lib/review-ask-rules";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import { formatNZPhone } from "@/shared/lib/normalise-phone";
import type React from "react";
import { useState } from "react";
import { useSendReviewAsk, type ReviewAskTarget } from "./use-send-review-ask";

/** One contact in the list. */
export interface AskPerson {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  /** ISO time of their latest ask by any route, or null when never asked. */
  lastAskedAt: string | null;
  status: AskPersonStatus;
}

type Filter = "ready" | "recent" | "reviewed" | "text_only" | "blocked" | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "ready", label: "Ready to ask" },
  { value: "recent", label: "Asked recently" },
  { value: "reviewed", label: "Reviewed on your site" },
  { value: "text_only", label: "Text only" },
  { value: "blocked", label: "Can't ask" },
  { value: "all", label: "Everyone" },
];

const STATUS_PILL: Record<AskPersonStatus, { label: string; tone: StatusTone }> = {
  ready: { label: "Ready", tone: "success" },
  recent: { label: "Asked recently", tone: "warning" },
  reviewed: { label: "Reviewed on your site", tone: "violet" },
  text_only: { label: "Text only", tone: "info" },
  review_opt_out: { label: "Asked you to stop", tone: "neutral" },
  mailing_opt_out: { label: "Unsubscribed from emails", tone: "neutral" },
  no_details: { label: "No email or phone", tone: "neutral" },
};

/** Rows per "Show more" batch. */
const BATCH = 15;

/**
 * Whether a row belongs under a filter chip.
 * @param status - The row's status.
 * @param filter - The selected chip.
 * @returns True when the row shows.
 */
function inFilter(status: AskPersonStatus, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "blocked") {
    return status === "review_opt_out" || status === "mailing_opt_out" || status === "no_details";
  }
  return status === filter;
}

/**
 * The contact list with per-person review-ask status and a send button on each row.
 * @param props - Component props.
 * @param props.people - Every live contact with their ask status, newest contact first.
 * @param props.gapDays - Days between asks from settings, for the "Asked recently" hint.
 * @returns List element.
 */
export function ReviewAskPeople({
  people: initialPeople,
  gapDays,
}: {
  people: AskPerson[];
  gapDays: number;
}): React.ReactElement {
  const [people, setPeople] = useState(initialPeople);
  const [filter, setFilter] = useState<Filter>("ready");
  const [query, setQuery] = useState("");

  // A sent ask moves the row to "Asked recently" (or keeps "Reviewed on your site")
  // straight away, rather than waiting for a reload.
  const ask = useSendReviewAsk((target: ReviewAskTarget) => {
    const at = new Date().toISOString();
    setPeople((prev) =>
      prev.map((p) =>
        p.email === target.email && p.name === target.name
          ? {
              ...p,
              lastAskedAt: at,
              status: p.status === "reviewed" || gapDays === 0 ? p.status : "recent",
            }
          : p,
      ),
    );
  });

  const q = query.trim().toLowerCase();
  const visible = people.filter((p) => {
    if (!inFilter(p.status, filter)) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.email?.toLowerCase().includes(q) ?? false) ||
      (p.address?.toLowerCase().includes(q) ?? false) ||
      (p.phone?.includes(q) ?? false)
    );
  });
  const pager = useShowMore(visible, BATCH, `${filter}|${q}`);

  /**
   * The send button for a row, or null when nothing can go to them.
   * @param p - The row.
   * @returns Button element or null.
   */
  function action(p: AskPerson): React.ReactElement | null {
    const target: ReviewAskTarget = {
      name: p.name,
      email: p.email,
      phone: p.phone,
      lastAskedAt: p.lastAskedAt,
    };
    if (p.status === "text_only") {
      return (
        <AdminButton size="xs" variant="secondary" onClick={() => ask.start(target, "sms")}>
          Text
        </AdminButton>
      );
    }
    if (p.status !== "ready" && p.status !== "recent" && p.status !== "reviewed") return null;
    return (
      <AdminButton
        size="xs"
        variant={p.status === "ready" ? "primary" : "secondary"}
        onClick={() => ask.start(target, "email")}
      >
        {p.lastAskedAt ? "Send again" : "Send"}
      </AdminButton>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        placeholder="Search name, email, phone or address…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:ring-1 focus:ring-russian-violet/30 focus:outline-none"
      />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count = people.filter((p) => inFilter(p.status, f.value)).length;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                filter === f.value
                  ? "border-russian-violet bg-russian-violet text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100",
              )}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      {filter === "recent" && gapDays > 0 && (
        <p className="text-xs text-admin-muted">
          Asked in the last {gapDays} days. You can still send again.
        </p>
      )}
      {filter === "reviewed" && (
        <p className="text-xs text-admin-muted">
          They reviewed on your site. The ask leads with Google, so it asks them to post it there
          too.
        </p>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-admin-muted">{q ? "No matching people." : "Nobody here."}</p>
      ) : (
        <ul className="divide-y divide-admin-border">
          {pager.visible.map((p) => {
            const pill = STATUS_PILL[p.status];
            const reach = p.email ?? (p.phone ? formatNZPhone(p.phone) : null);
            return (
              <li key={p.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium text-admin-text">{p.name}</span>
                    <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                  </div>
                  <p className="mt-0.5 text-xs break-all text-admin-muted">
                    {reach ?? "No email or phone"}
                    {" · "}
                    {p.lastAskedAt ? `Last asked ${formatDateShort(p.lastAskedAt)}` : "Never asked"}
                  </p>
                </div>
                <div className="shrink-0">{action(p)}</div>
              </li>
            );
          })}
        </ul>
      )}
      <ShowMoreButton pager={pager} noun={["person", "people"]} />

      {ask.dialog}
    </div>
  );
}
