"use client";
// src/features/booking/components/admin/BookingAdminList.tsx
/**
 * @description Admin bookings list: summary StatCards, status pills, free-text
 * search (name / email / phone), a start-date range filter, and sortable columns.
 * Editing and the full action set (cancel, no-show, delete) live on the booking
 * detail page now; the list keeps only the two common quick actions - mark
 * completed and send / resend review - each behind a {@link ConfirmDialog} and
 * routed through {@link useBookingActions}. Each row links to its detail page.
 */

import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { StatusPill, type StatusTone } from "@/features/admin/components/ui/StatusPill";
import { useBookingActions } from "@/features/booking/hooks/use-booking-actions";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";
import { useMemo, useState } from "react";

export interface AdminBookingRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  startAt: string;
  endAt: string;
  createdAt: string;
  status: "held" | "confirmed" | "cancelled" | "completed";
  cancelToken: string;
  reviewSentAt: string | null;
  cancelledAt: string | null;
  noShow: boolean;
  /** Public quote the customer saw before booking (snapshot); null when they didn't get one. */
  quotedLow: number | null;
  quotedHigh: number | null;
}

type StatusFilter = "all" | "held" | "confirmed" | "cancelled" | "completed";
type SortKey = "name" | "start" | "status";
type SortDir = "asc" | "desc";

/** StatusPill tone for each booking status. */
const STATUS_TONE: Record<AdminBookingRow["status"], StatusTone> = {
  confirmed: "info",
  held: "warning",
  completed: "success",
  cancelled: "critical",
};

/** Which quick action a confirm dialog is gating. */
interface PendingAction {
  id: string;
  kind: "complete" | "review";
  alreadySent: boolean;
}

/**
 * Admin booking list with StatCards, filters, sortable columns, and per-row
 * quick actions (mark completed, send review).
 * @param props - Component props.
 * @param props.bookings - Initial booking rows from the server.
 * @returns Booking admin list element.
 */
export function BookingAdminList({
  bookings: initial,
}: {
  bookings: AdminBookingRow[];
}): React.ReactElement {
  const actions = useBookingActions();
  const [bookings, setBookings] = useState<AdminBookingRow[]>(initial);
  const [filter, setFilter] = useState<StatusFilter>("confirmed");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("start");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  // Stable "now" so the upcoming/this-month checks don't trip react-hooks/purity.
  const [renderedAt] = useState(() => Date.now());

  const counts = {
    held: bookings.filter((b) => b.status === "held").length,
    confirmed: bookings.filter((b) => b.status === "confirmed").length,
    cancelled: bookings.filter((b) => b.status === "cancelled").length,
    completed: bookings.filter((b) => b.status === "completed").length,
  };

  // Summary stats. "This month" is derived from a stable render-time clock.
  const monthStart = useMemo(() => {
    const now = new Date(renderedAt);
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  }, [renderedAt]);

  const stats = useMemo(() => {
    let upcoming = 0;
    let completedThisMonth = 0;
    let cancelledThisMonth = 0;
    for (const b of bookings) {
      if (b.status === "confirmed" && new Date(b.startAt).getTime() > renderedAt) upcoming++;
      if (b.status === "completed" && new Date(b.startAt).getTime() >= monthStart) {
        completedThisMonth++;
      }
      if (
        b.status === "cancelled" &&
        b.cancelledAt &&
        new Date(b.cancelledAt).getTime() >= monthStart
      ) {
        cancelledThisMonth++;
      }
    }
    return { upcoming, completedThisMonth, cancelledThisMonth, held: counts.held };
  }, [bookings, renderedAt, monthStart, counts.held]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = bookings.filter((b) => {
      if (filter !== "all" && b.status !== filter) return false;
      if (q) {
        const hay = `${b.name} ${b.email} ${b.phone ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      const day = b.startAt.slice(0, 10);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return rows.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name) * dir;
      if (sortKey === "status") return a.status.localeCompare(b.status) * dir;
      return (new Date(a.startAt).getTime() - new Date(b.startAt).getTime()) * dir;
    });
  }, [bookings, filter, query, dateFrom, dateTo, sortKey, sortDir]);

  /**
   * Toggles the sort direction when re-selecting the active column, else switches
   * to the new column with a sensible default direction.
   * @param key - Column to sort by.
   */
  function toggleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "start" ? "desc" : "asc");
    }
  }

  /**
   * Runs the pending quick action (mark completed / send review), applies the
   * optimistic local update on success, and closes the dialog.
   */
  async function runPending(): Promise<void> {
    if (!pending) return;
    const { id, kind, alreadySent } = pending;
    setBusyId(id);
    const result =
      kind === "complete"
        ? await actions.completeBooking(id)
        : await actions.resendReview(id, alreadySent);
    setBusyId(null);
    setPending(null);
    if (!result.ok) return;
    setBookings((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        if (kind === "complete") {
          return {
            ...b,
            status: "completed",
            reviewSentAt: result.reviewSent ? new Date().toISOString() : b.reviewSentAt,
          };
        }
        return { ...b, reviewSentAt: new Date().toISOString() };
      }),
    );
  }

  const FILTERS: StatusFilter[] = ["all", "confirmed", "held", "completed", "cancelled"];

  return (
    <div className="flex flex-col gap-4">
      {/* Summary StatCards. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Upcoming confirmed" value={stats.upcoming} tone="default" />
        <StatCard label="Completed this month" value={stats.completedThisMonth} tone="success" />
        <StatCard
          label="Cancelled / no-show this month"
          value={stats.cancelledThisMonth}
          tone={stats.cancelledThisMonth > 0 ? "critical" : "default"}
        />
        <StatCard label="Held" value={stats.held} tone={stats.held > 0 ? "warning" : "default"} />
      </div>

      {/* Filters + search. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-100 p-0.5">
          {FILTERS.map((f) => {
            const label = f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1);
            const count = f === "all" ? bookings.length : counts[f];
            const isActive = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-white text-russian-violet shadow-sm"
                    : "text-slate-500 hover:text-slate-700",
                )}
              >
                {label}{" "}
                <span className={cn(isActive ? "text-russian-violet/60" : "text-slate-400")}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, phone"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none sm:w-56"
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="From date"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="To date"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none"
          />
          {(dateFrom || dateTo || query) && (
            <button
              onClick={() => {
                setDateFrom("");
                setDateTo("");
                setQuery("");
              }}
              className="text-xs font-medium text-slate-500 underline hover:text-slate-700"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-400">No bookings found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <SortHeader
                  label="Customer"
                  active={sortKey === "name"}
                  dir={sortDir}
                  onClick={() => toggleSort("name")}
                />
                <SortHeader
                  label="When"
                  active={sortKey === "start"}
                  dir={sortDir}
                  onClick={() => toggleSort("start")}
                />
                <SortHeader
                  label="Status"
                  active={sortKey === "status"}
                  dir={sortDir}
                  onClick={() => toggleSort("status")}
                />
                <th className="px-3 py-2 font-semibold">Quoted</th>
                <th className="px-3 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const isBusy = busyId === b.id;
                const reviewable = b.status === "confirmed" || b.status === "completed";
                return (
                  <tr key={b.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-3 align-top">
                      <Link
                        href={`/admin/bookings/${b.id}`}
                        className="font-semibold text-russian-violet hover:underline"
                      >
                        {b.name}
                      </Link>
                      <div className="text-xs break-all text-slate-500">{b.email}</div>
                      {b.phone && <div className="text-xs text-slate-500">{b.phone}</div>}
                    </td>
                    <td className="px-3 py-3 align-top whitespace-nowrap text-slate-600">
                      {formatDateTimeShort(b.startAt)}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <StatusPill tone={STATUS_TONE[b.status]}>{b.status}</StatusPill>
                    </td>
                    <td className="px-3 py-3 align-top whitespace-nowrap text-slate-600">
                      {b.quotedLow != null && b.quotedHigh != null ? (
                        `$${b.quotedLow} - $${b.quotedHigh}`
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right align-top">
                      <div className="flex flex-wrap justify-end gap-2">
                        {b.status === "confirmed" && (
                          <button
                            onClick={() =>
                              setPending({ id: b.id, kind: "complete", alreadySent: false })
                            }
                            disabled={isBusy}
                            className="rounded-lg bg-green-500/20 px-2.5 py-1.5 text-xs font-medium text-green-700 transition-colors hover:bg-green-500/30 disabled:opacity-50"
                          >
                            Complete
                          </button>
                        )}
                        {reviewable && (
                          <button
                            onClick={() =>
                              setPending({
                                id: b.id,
                                kind: "review",
                                alreadySent: b.reviewSentAt != null,
                              })
                            }
                            disabled={isBusy}
                            className="rounded-lg bg-moonstone-600/15 px-2.5 py-1.5 text-xs font-medium text-moonstone-700 transition-colors hover:bg-moonstone-600/25 disabled:opacity-50"
                          >
                            {b.reviewSentAt ? "Resend review" : "Send review"}
                          </button>
                        )}
                        <Link
                          href={`/admin/bookings/${b.id}`}
                          className="rounded-lg bg-russian-violet/10 px-2.5 py-1.5 text-xs font-medium text-russian-violet transition-colors hover:bg-russian-violet/20"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === "complete"
            ? "Mark this booking completed?"
            : pending?.alreadySent
              ? "Resend the review email?"
              : "Send the review email?"
        }
        body={
          pending?.kind === "complete"
            ? "This also sends the review-request email if one hasn't gone out yet."
            : "Emails the customer a link to leave a review for this booking."
        }
        confirmLabel={pending?.kind === "complete" ? "Mark completed" : "Send email"}
        busy={busyId !== null}
        onConfirm={() => void runPending()}
        onCancel={() => busyId === null && setPending(null)}
      />
    </div>
  );
}

/**
 * A sortable table header cell.
 * @param props - Component props.
 * @param props.label - Column label.
 * @param props.active - Whether this column is the active sort.
 * @param props.dir - Current sort direction.
 * @param props.onClick - Click handler to toggle/select the sort.
 * @returns The header cell element.
 */
function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}): React.ReactElement {
  return (
    <th className="px-3 py-2 font-semibold">
      <button
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-slate-700",
          active && "text-russian-violet",
        )}
      >
        {label}
        <span className="text-[0.65rem]">{active ? (dir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}
