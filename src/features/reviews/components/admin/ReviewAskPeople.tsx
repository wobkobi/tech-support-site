"use client";
// src/features/reviews/components/admin/ReviewAskPeople.tsx
// "Who you can ask" on the admin reviews page: every contact, with whether a review ask
// can go to them and when they were last asked, filtered by where they stand. Each row
// sends (or re-sends) the Google-first ask by email, or composes a text for phone-only
// contacts. Rows with an email can be ticked and sent to in one go. Opted-out people are
// listed so it's clear why they have no button.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Modal } from "@/features/admin/components/ui/Modal";
import { ShowMoreButton } from "@/features/admin/components/ui/ShowMoreButton";
import { StatusPill, type StatusTone } from "@/features/admin/components/ui/StatusPill";
import { useShowMore } from "@/features/admin/hooks/use-show-more";
import type { AskPersonStatus } from "@/features/reviews/lib/review-ask-rules";
import { apiFetch } from "@/shared/lib/api-client";
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

/** Gap between bulk sends, keeping a long run under Resend's requests-per-second limit. */
const BULK_GAP_MS = 600;

type BulkState =
  | { kind: "closed" }
  | { kind: "confirm" }
  | { kind: "sending"; done: number; total: number }
  | { kind: "finished"; sent: number; failed: { id: string; name: string; error: string }[] };

/**
 * "person" or "people" to suit a count.
 * @param n - How many.
 * @returns The noun.
 */
function peopleWord(n: number): string {
  return n === 1 ? "person" : "people";
}

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
 * Whether a row can be ticked for a bulk send. Bulk goes by email only: a text has to
 * be copied and sent from the phone one at a time.
 * @param p - The row.
 * @returns True when the row gets a checkbox.
 */
function canBulkSend(p: AskPerson): boolean {
  return (
    p.email !== null && (p.status === "ready" || p.status === "recent" || p.status === "reviewed")
  );
}

/**
 * The contact list with per-person review-ask status, a send button on each row, and
 * checkboxes for sending to several people at once.
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
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<BulkState>({ kind: "closed" });

  /**
   * Moves matching rows to "Asked recently" (or keeps "Reviewed on your site") straight
   * away after a send, rather than waiting for a reload.
   * @param match - Picks the rows that were just asked.
   */
  function markAsked(match: (p: AskPerson) => boolean): void {
    const at = new Date().toISOString();
    setPeople((prev) =>
      prev.map((p) =>
        match(p)
          ? {
              ...p,
              lastAskedAt: at,
              status: p.status === "reviewed" || gapDays === 0 ? p.status : "recent",
            }
          : p,
      ),
    );
  }

  const ask = useSendReviewAsk((target: ReviewAskTarget) =>
    markAsked((p) => p.email === target.email && p.name === target.name),
  );

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

  // "Select all" covers every matching row, not only the batch on screen.
  const selectable = visible.filter(canBulkSend);
  const allSelected = selectable.length > 0 && selectable.every((p) => selected.has(p.id));
  const chosen = people.filter((p) => selected.has(p.id) && canBulkSend(p));
  const chosenRecent = chosen.filter((p) => p.status === "recent").length;

  /**
   * Ticks or unticks one row.
   * @param id - The row's contact id.
   * @param on - Whether it's now ticked.
   */
  function toggle(id: string, on: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Ticks every matching row, or unticks them all when they're already ticked. */
  function toggleAll(): void {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of selectable) {
        if (allSelected) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  }

  /**
   * Sends the ask to every ticked person, one at a time through the same route as a
   * single send, so opt-outs made since the page loaded are still refused. Anyone who
   * fails stays ticked for another go.
   */
  async function sendBulk(): Promise<void> {
    const list = chosen;
    const failed: { id: string; name: string; error: string }[] = [];
    let sent = 0;
    for (const [i, p] of list.entries()) {
      setBulk({ kind: "sending", done: i, total: list.length });
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, BULK_GAP_MS));
      const res = await apiFetch("/api/admin/send-review-link", {
        method: "POST",
        json: { name: p.name, email: p.email, mode: "email", resend: true },
      });
      if (res.ok) {
        sent++;
        markAsked((row) => row.id === p.id);
      } else {
        failed.push({ id: p.id, name: p.name, error: res.error });
      }
    }
    setSelected(new Set(failed.map((f) => f.id)));
    setBulk({ kind: "finished", sent, failed });
  }

  /** Closes the bulk dialog, except mid-run where closing would hide the progress. */
  function closeBulk(): void {
    if (bulk.kind === "sending") return;
    setBulk({ kind: "closed" });
  }

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

      {(selectable.length > 0 || chosen.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
          <label className="flex items-center gap-2 text-sm text-admin-text">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              disabled={selectable.length === 0}
              className="h-4 w-4 rounded border-admin-border-strong"
            />
            Select all {selectable.length} with an email
          </label>
          {chosen.length > 0 && (
            <div className="flex gap-2">
              <AdminButton size="xs" variant="secondary" onClick={() => setSelected(new Set())}>
                Clear
              </AdminButton>
              <AdminButton size="xs" onClick={() => setBulk({ kind: "confirm" })}>
                Send to {chosen.length} {peopleWord(chosen.length)}
              </AdminButton>
            </div>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-admin-muted">{q ? "No matching people." : "Nobody here."}</p>
      ) : (
        <ul className="divide-y divide-admin-border">
          {pager.visible.map((p) => {
            const pill = STATUS_PILL[p.status];
            const reach = p.email ?? (p.phone ? formatNZPhone(p.phone) : null);
            return (
              <li key={p.id} className="flex items-start gap-3 py-2.5">
                {canBulkSend(p) ? (
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                    aria-label={`Select ${p.name}`}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-admin-border-strong"
                  />
                ) : (
                  <span className="w-4 shrink-0" aria-hidden />
                )}
                <div className="min-w-0 flex-1 text-sm">
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

      <Modal
        open={bulk.kind !== "closed"}
        onClose={closeBulk}
        title={
          bulk.kind === "finished"
            ? "Review asks sent"
            : `Send the review ask to ${chosen.length} ${peopleWord(chosen.length)}?`
        }
        description={
          bulk.kind === "confirm"
            ? "Each person gets the same email as a single send, Google first."
            : undefined
        }
        footer={
          bulk.kind === "finished" ? (
            <AdminButton onClick={closeBulk}>Close</AdminButton>
          ) : (
            <>
              <AdminButton
                variant="secondary"
                onClick={closeBulk}
                disabled={bulk.kind === "sending"}
              >
                Cancel
              </AdminButton>
              <AdminButton
                onClick={() => void sendBulk()}
                busy={bulk.kind === "sending"}
                disabled={bulk.kind === "sending" || chosen.length === 0}
              >
                {bulk.kind === "sending"
                  ? `Sending ${bulk.done + 1} of ${bulk.total}...`
                  : `Send ${chosen.length} ${chosen.length === 1 ? "email" : "emails"}`}
              </AdminButton>
            </>
          )
        }
      >
        {bulk.kind === "confirm" && (
          <div className="flex flex-col gap-3 text-sm text-admin-text">
            {chosenRecent > 0 && (
              <p>
                {chosenRecent} of them {chosenRecent === 1 ? "was" : "were"} asked in the last{" "}
                {gapDays} days.
              </p>
            )}
            <ul className="max-h-64 divide-y divide-admin-border overflow-y-auto rounded-lg border border-admin-border">
              {chosen.map((p) => (
                <li key={p.id} className="px-3 py-1.5">
                  <span className="font-medium">{p.name}</span>{" "}
                  <span className="text-admin-muted">{p.email}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {bulk.kind === "sending" && (
          <p className="text-sm text-admin-text">
            Sending {bulk.done + 1} of {bulk.total}. Keep this page open until it finishes.
          </p>
        )}
        {bulk.kind === "finished" && (
          <div className="flex flex-col gap-2 text-sm text-admin-text">
            <p>
              Sent to {bulk.sent} {peopleWord(bulk.sent)}.
            </p>
            {bulk.failed.length > 0 && (
              <>
                <p>
                  {bulk.failed.length} didn&apos;t go. They&apos;re still ticked if you want to try
                  again:
                </p>
                <ul className="list-disc pl-5">
                  {bulk.failed.map((f) => (
                    <li key={f.id}>
                      {f.name}: {f.error}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
