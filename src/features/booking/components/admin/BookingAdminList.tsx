"use client";
// src/features/booking/components/admin/BookingAdminList.tsx
/**
 * @file BookingAdminList.tsx
 * @description Interactive admin component for viewing and editing bookings.
 */

import { useState } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";

export interface AdminBookingRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  notes: string | null;
  startAt: string;
  endAt: string;
  createdAt: string;
  status: "held" | "confirmed" | "cancelled" | "completed";
  cancelToken: string;
  reviewSentAt: string | null;
}

type StatusFilter = "all" | "held" | "confirmed" | "cancelled" | "completed";

interface EditState {
  name: string;
  email: string;
  phone: string;
  notes: string;
  address: string;
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
  const [resending, setResending] = useState<string | null>(null);
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
      const address = (b.notes ?? "").match(/Address:\s*(.+)/i)?.[1]?.trim() ?? "";
      setEdits((prev) => ({
        ...prev,
        [b.id]: {
          name: b.name,
          email: b.email,
          phone: b.phone ?? "",
          notes: b.notes ?? "",
          address,
        },
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
    const updatedNotes = edit.address
      ? edit.notes.replace(/^(Address:\s*).*$/im, `$1${edit.address.trim()}`)
      : edit.notes;
    const ok = await patch(b.id, {
      name: edit.name,
      email: edit.email,
      phone: edit.phone || undefined,
      notes: updatedNotes,
      address: edit.address || undefined,
    });
    if (ok) {
      setBookings((prev) =>
        prev.map((r) =>
          r.id === b.id
            ? {
                ...r,
                name: edit.name,
                email: edit.email,
                phone: edit.phone || null,
                notes: updatedNotes,
              }
            : r,
        ),
      );
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

  /**
   * Permanently deletes a booking and its calendar event.
   * @param id - Booking ID to delete.
   */
  async function deleteBooking(id: string): Promise<void> {
    setSaving(id);
    setErrors((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/admin/bookings/${id}`, {
        method: "DELETE",
        headers: { "x-admin-secret": token },
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setErrors((prev) => ({ ...prev, [id]: data.error ?? "Failed." }));
        return;
      }
      setBookings((prev) => prev.filter((b) => b.id !== id));
      setExpandedId(null);
    } finally {
      setSaving(null);
    }
  }

  /**
   * Sends or resends the review request email for a booking.
   * @param id - Booking ID.
   */
  async function resendReview(id: string): Promise<void> {
    setResending(id);
    setErrors((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/admin/bookings/${id}/resend-review`, {
        method: "POST",
        headers: { "x-admin-secret": token },
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setErrors((prev) => ({ ...prev, [id]: data.error ?? "Failed to send." }));
        return;
      }
      setBookings((prev) =>
        prev.map((b) => (b.id === id ? { ...b, reviewSentAt: new Date().toISOString() } : b)),
      );
    } finally {
      setResending(null);
    }
  }

  const FILTERS: StatusFilter[] = ["all", "confirmed", "held", "completed", "cancelled"];

  return (
    <div className={cn("flex flex-col gap-4")}>
      {/* Status filter */}
      <div
        className={cn(
          "inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-100 p-0.5",
        )}
      >
        {FILTERS.map((f) => {
          const label = f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1);
          const count = f === "all" ? bookings.length : counts[f as keyof typeof counts];
          const isActive = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "text-russian-violet bg-white shadow-sm"
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

      {filtered.length === 0 && <p className={cn("text-sm text-slate-400")}>No bookings found.</p>}

      <div className={cn("flex flex-col gap-3")}>
        {filtered.map((b) => {
          const isExpanded = expandedId === b.id;
          const edit = edits[b.id] ?? {
            name: b.name,
            email: b.email,
            phone: b.phone ?? "",
            notes: b.notes ?? "",
            address: (b.notes ?? "").match(/Address:\s*(.+)/i)?.[1]?.trim() ?? "",
          };
          const isSaving = saving === b.id;
          const isResending = resending === b.id;

          return (
            <div key={b.id} className={cn("rounded-xl border border-slate-200 bg-white p-4")}>
              <div className={cn("flex items-start justify-between gap-3")}>
                <div
                  className={cn("flex min-w-0 cursor-pointer flex-col gap-1")}
                  onClick={() => {
                    if (isExpanded) {
                      setExpandedId(null);
                    } else {
                      openEdit(b);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      if (isExpanded) {
                        setExpandedId(null);
                      } else {
                        openEdit(b);
                      }
                    }
                  }}
                >
                  <div className={cn("flex min-w-0 flex-wrap items-center gap-2")}>
                    <span className={cn("text-russian-violet min-w-0 truncate font-semibold")}>
                      {b.name}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                        STATUS_COLORS[b.status],
                      )}
                    >
                      {b.status}
                    </span>
                  </div>
                  <span className={cn("break-all text-xs text-slate-500")}>{b.email}</span>
                  {b.phone && <span className={cn("text-xs text-slate-500")}>{b.phone}</span>}
                  <span className={cn("text-xs text-slate-500")}>
                    {formatNZDateTime(b.startAt)} &ndash; {formatNZDateTime(b.endAt)}
                  </span>
                </div>

                <div className={cn("flex shrink-0 gap-2")}>
                  {b.name.toLowerCase().includes("test") && (
                    <button
                      onClick={() => {
                        if (
                          confirm("Permanently delete this test booking? This cannot be undone.")
                        ) {
                          void deleteBooking(b.id);
                        }
                      }}
                      disabled={isSaving}
                      className={cn(
                        "rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/30 disabled:opacity-50",
                      )}
                    >
                      Delete
                    </button>
                  )}
                  {b.status !== "cancelled" && (
                    <>
                      {new Date(b.startAt) > new Date() && (
                        <a
                          href={`/booking/edit?token=${b.cancelToken}`}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            "bg-russian-violet/10 text-russian-violet hover:bg-russian-violet/20 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                          )}
                        >
                          Reschedule
                        </a>
                      )}
                      <button
                        onClick={() => (isExpanded ? setExpandedId(null) : openEdit(b))}
                        className={cn(
                          "bg-russian-violet/10 text-russian-violet hover:bg-russian-violet/20 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                        )}
                      >
                        {isExpanded ? "Close" : "Edit"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className={cn("mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4")}>
                  <p className={cn("text-xs text-slate-400")}>
                    Booked on {formatNZDateTime(b.createdAt)}
                  </p>
                  <div className={cn("grid gap-3 sm:grid-cols-2")}>
                    <label className={cn("flex flex-col gap-1")}>
                      <span className={cn("text-russian-violet text-xs font-semibold")}>Name</span>
                      <input
                        className={cn(
                          "focus:border-russian-violet focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1",
                        )}
                        value={edit.name}
                        onChange={(e) => setField(b.id, "name", e.target.value)}
                      />
                    </label>
                    <label className={cn("flex flex-col gap-1")}>
                      <span className={cn("text-russian-violet text-xs font-semibold")}>Email</span>
                      <input
                        type="email"
                        className={cn(
                          "focus:border-russian-violet focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1",
                        )}
                        value={edit.email}
                        onChange={(e) => setField(b.id, "email", e.target.value)}
                      />
                    </label>
                    <label className={cn("flex flex-col gap-1")}>
                      <span className={cn("text-russian-violet text-xs font-semibold")}>Phone</span>
                      <input
                        type="tel"
                        className={cn(
                          "focus:border-russian-violet focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1",
                        )}
                        value={edit.phone}
                        onChange={(e) => setField(b.id, "phone", e.target.value)}
                        placeholder="Phone number"
                      />
                    </label>
                  </div>

                  {edit.address !== undefined && edit.address !== "" && (
                    <div className={cn("flex flex-col gap-1")}>
                      <span className={cn("text-russian-violet text-xs font-semibold")}>
                        Address
                      </span>
                      <AddressAutocomplete
                        id={`edit-address-${b.id}`}
                        value={edit.address}
                        onChange={(v: string) => setField(b.id, "address", v)}
                        placeholder="Full address for travel time calculations"
                      />
                    </div>
                  )}

                  <label className={cn("flex flex-col gap-1")}>
                    <span className={cn("text-russian-violet text-xs font-semibold")}>Notes</span>
                    <textarea
                      className={cn(
                        "focus:border-russian-violet focus:ring-russian-violet/30 min-h-25 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1",
                      )}
                      value={edit.notes}
                      onChange={(e) => setField(b.id, "notes", e.target.value)}
                    />
                  </label>

                  {errors[b.id] && <p className={cn("text-xs text-red-500")}>{errors[b.id]}</p>}

                  <div className={cn("flex flex-wrap gap-2")}>
                    <button
                      onClick={() => saveEdit(b)}
                      disabled={isSaving}
                      className={cn(
                        "bg-russian-violet hover:bg-russian-violet/90 rounded-lg px-4 py-2 text-xs font-medium text-white transition-colors disabled:opacity-50",
                      )}
                    >
                      {isSaving ? "Saving\u2026" : "Save changes"}
                    </button>

                    {b.status === "confirmed" && (
                      <button
                        onClick={() => changeStatus(b.id, "completed")}
                        disabled={isSaving}
                        className={cn(
                          "rounded-lg bg-green-500/20 px-4 py-2 text-xs font-medium text-green-700 transition-colors hover:bg-green-500/30 disabled:opacity-50",
                        )}
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
                      className={cn(
                        "rounded-lg bg-red-500/20 px-4 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/30 disabled:opacity-50",
                      )}
                    >
                      Cancel booking
                    </button>

                    {(b.status === "confirmed" || b.status === "completed") && (
                      <button
                        onClick={() => void resendReview(b.id)}
                        disabled={isSaving || isResending}
                        className={cn(
                          "bg-moonstone-600/15 text-moonstone-700 hover:bg-moonstone-600/25 rounded-lg px-4 py-2 text-xs font-medium transition-colors disabled:opacity-50",
                        )}
                      >
                        {isResending
                          ? "Sending\u2026"
                          : b.reviewSentAt
                            ? "Resend review email"
                            : "Send review email"}
                      </button>
                    )}
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
