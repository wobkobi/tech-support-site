"use client";
// src/features/booking/components/admin/BookingAdminList.tsx
/**
 * @file BookingAdminList.tsx
 * @description Interactive admin component for viewing and editing bookings.
 */

import { useState } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";

export interface AdminBookingRow {
  id: string;
  name: string;
  email: string;
  notes: string | null;
  startAt: string;
  endAt: string;
  status: "held" | "confirmed" | "cancelled" | "completed";
  cancelToken: string;
}

type StatusFilter = "all" | "held" | "confirmed" | "cancelled" | "completed";

interface EditState {
  name: string;
  email: string;
  notes: string;
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: "bg-moonstone-600/20 text-moonstone-600",
  held: "bg-yellow-500/20 text-yellow-600",
  cancelled: "bg-red-500/20 text-red-500",
  completed: "bg-green-500/20 text-green-600",
};

/**
 * Formats an ISO date string as a short NZ local date/time.
 * @param iso - ISO 8601 date string.
 * @returns Formatted date/time string in Pacific/Auckland timezone.
 */
function formatNZDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/**
 * Admin booking list with filter, inline edit, status change, and cancel.
 * @param props - Component props.
 * @param props.bookings - Initial booking rows from the server.
 * @param props.token - Admin token for API calls.
 * @returns Booking admin list element.
 */
export function BookingAdminList({
  bookings: initial,
  token,
}: {
  bookings: AdminBookingRow[];
  token: string;
}): React.ReactElement {
  const [bookings, setBookings] = useState<AdminBookingRow[]>(initial);
  const [filter, setFilter] = useState<StatusFilter>("confirmed");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const counts = {
    held: bookings.filter((b) => b.status === "held").length,
    confirmed: bookings.filter((b) => b.status === "confirmed").length,
    cancelled: bookings.filter((b) => b.status === "cancelled").length,
    completed: bookings.filter((b) => b.status === "completed").length,
  };

  const filtered = filter === "all" ? bookings : bookings.filter((b) => b.status === filter);

  /**
   * Expands a booking row for editing and seeds its edit state.
   * @param b - Booking row to open.
   */
  function openEdit(b: AdminBookingRow): void {
    setExpandedId(b.id);
    if (!edits[b.id]) {
      setEdits((prev) => ({
        ...prev,
        [b.id]: { name: b.name, email: b.email, notes: b.notes ?? "" },
      }));
    }
  }

  /**
   * Updates a single field in a booking's edit state.
   * @param id - Booking ID.
   * @param field - Field name to update.
   * @param value - New value.
   */
  function setField(id: string, field: keyof EditState, value: string): void {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  /**
   * Sends a PATCH request to the admin bookings API.
   * @param id - Booking ID to update.
   * @param body - Fields to update.
   * @returns True if the request succeeded.
   */
  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    setSaving(id);
    setErrors((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/admin/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-secret": token },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setErrors((prev) => ({ ...prev, [id]: data.error ?? "Failed." }));
        return false;
      }
      return true;
    } finally {
      setSaving(null);
    }
  }

  /**
   * Saves name, email, and notes edits for a booking.
   * @param b - Booking row being edited.
   */
  async function saveEdit(b: AdminBookingRow): Promise<void> {
    const edit = edits[b.id];
    if (!edit) return;
    const ok = await patch(b.id, { name: edit.name, email: edit.email, notes: edit.notes });
    if (ok) {
      setBookings((prev) => prev.map((r) => (r.id === b.id ? { ...r, ...edit } : r)));
      setExpandedId(null);
    }
  }

  /**
   * Changes a booking's status to cancelled or completed.
   * @param id - Booking ID.
   * @param status - New status to apply.
   */
  async function changeStatus(id: string, status: "cancelled" | "completed"): Promise<void> {
    const ok = await patch(id, { status });
    if (ok) {
      setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status } : b)));
      setExpandedId(null);
    }
  }

  const FILTERS: StatusFilter[] = ["all", "confirmed", "held", "completed", "cancelled"];

  return (
    <div className="flex flex-col gap-4">
      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              filter === f
                ? "bg-russian-violet text-white"
                : "text-rich-black/60 hover:bg-russian-violet/10",
            )}
          >
            {f === "all"
              ? `All (${bookings.length})`
              : `${f.charAt(0).toUpperCase()}${f.slice(1)} (${counts[f as keyof typeof counts]})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 && <p className="text-rich-black/40 text-sm">No bookings found.</p>}

      <div className="flex flex-col gap-3">
        {filtered.map((b) => {
          const isExpanded = expandedId === b.id;
          const edit = edits[b.id] ?? { name: b.name, email: b.email, notes: b.notes ?? "" };
          const isSaving = saving === b.id;

          return (
            <div key={b.id} className="border-seasalt-400/30 rounded-xl border bg-white/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-russian-violet font-semibold">{b.name}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        STATUS_COLORS[b.status],
                      )}
                    >
                      {b.status}
                    </span>
                  </div>
                  <span className="text-rich-black/50 text-xs">{b.email}</span>
                  <span className="text-rich-black/60 text-xs">
                    {formatNZDateTime(b.startAt)} &ndash; {formatNZDateTime(b.endAt)}
                  </span>
                </div>

                <div className="flex shrink-0 gap-2">
                  {b.status !== "cancelled" && (
                    <>
                      <a
                        href={`/booking/edit?token=${b.cancelToken}`}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-russian-violet/10 text-russian-violet hover:bg-russian-violet/20 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                      >
                        Reschedule
                      </a>
                      <button
                        onClick={() => (isExpanded ? setExpandedId(null) : openEdit(b))}
                        className="bg-russian-violet/10 text-russian-violet hover:bg-russian-violet/20 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                      >
                        {isExpanded ? "Close" : "Edit"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="border-seasalt-400/20 mt-4 flex flex-col gap-3 border-t pt-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-rich-black/60 text-xs font-medium">Name</span>
                      <input
                        className="border-seasalt-400/30 rounded-lg border bg-white/80 px-3 py-2 text-sm"
                        value={edit.name}
                        onChange={(e) => setField(b.id, "name", e.target.value)}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-rich-black/60 text-xs font-medium">Email</span>
                      <input
                        type="email"
                        className="border-seasalt-400/30 rounded-lg border bg-white/80 px-3 py-2 text-sm"
                        value={edit.email}
                        onChange={(e) => setField(b.id, "email", e.target.value)}
                      />
                    </label>
                  </div>

                  <label className="flex flex-col gap-1">
                    <span className="text-rich-black/60 text-xs font-medium">Notes</span>
                    <textarea
                      className="min-h-25 border-seasalt-400/30 rounded-lg border bg-white/80 px-3 py-2 text-sm"
                      value={edit.notes}
                      onChange={(e) => setField(b.id, "notes", e.target.value)}
                    />
                  </label>

                  {errors[b.id] && <p className="text-xs text-red-500">{errors[b.id]}</p>}

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => saveEdit(b)}
                      disabled={isSaving}
                      className="bg-russian-violet hover:bg-russian-violet/90 rounded-lg px-4 py-2 text-xs font-medium text-white transition-colors disabled:opacity-50"
                    >
                      {isSaving ? "Saving\u2026" : "Save changes"}
                    </button>

                    {b.status === "confirmed" && (
                      <button
                        onClick={() => changeStatus(b.id, "completed")}
                        disabled={isSaving}
                        className="rounded-lg bg-green-500/20 px-4 py-2 text-xs font-medium text-green-700 transition-colors hover:bg-green-500/30 disabled:opacity-50"
                      >
                        Mark completed
                      </button>
                    )}

                    <button
                      onClick={() => {
                        if (confirm("Cancel this booking? This cannot be undone.")) {
                          void changeStatus(b.id, "cancelled");
                        }
                      }}
                      disabled={isSaving}
                      className="rounded-lg bg-red-500/20 px-4 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/30 disabled:opacity-50"
                    >
                      Cancel booking
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
