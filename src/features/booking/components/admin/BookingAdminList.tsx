"use client";
// src/features/booking/components/admin/BookingAdminList.tsx
/**
 * @file BookingAdminList.tsx
 * @description Interactive admin component for viewing and editing bookings.
 */

import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import type React from "react";
import { useState } from "react";

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
  /** Public quote the customer saw before booking (snapshot); null when they didn't get one. */
  quotedLow: number | null;
  quotedHigh: number | null;
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
 * Admin booking list with filter, inline edit, status change, and cancel.
 * @param props - Component props.
 * @param props.bookings - Initial booking rows from the server.
 * @returns Booking admin list element.
 */
export function BookingAdminList({
  bookings: initial,
}: {
  bookings: AdminBookingRow[];
}): React.ReactElement {
  const [bookings, setBookings] = useState<AdminBookingRow[]>(initial);
  const [filter, setFilter] = useState<StatusFilter>("confirmed");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Stable "now" so the no-show button check doesn't trigger react-hooks/purity.
  const [renderedAt] = useState(() => Date.now());

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
        headers: { "Content-Type": "application/json" },
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
   * @param cancelMode - When cancelling, distinguishes operator-side cancels (no fee)
   *   from on-behalf-of-customer cancels (customer fee rules apply). Ignored for "completed".
   */
  async function changeStatus(
    id: string,
    status: "cancelled" | "completed",
    cancelMode: "operator" | "on-behalf" = "operator",
  ): Promise<void> {
    const body: Record<string, unknown> = { status };
    if (status === "cancelled") body.cancelMode = cancelMode;
    const ok = await patch(id, body);
    if (ok) {
      setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status } : b)));
      setExpandedId(null);
    }
  }

  /**
   * Marks a booking as a no-show. Triggers the draft late-cancellation
   * invoice (callout + travel) just like a same-time customer cancel would.
   * @param id - Booking ID.
   */
  async function markNoShow(id: string): Promise<void> {
    const ok = await patch(id, { markNoShow: true });
    if (ok) {
      setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: "cancelled" } : b)));
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
        headers: {},
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
        headers: {},
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
              <div
                className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between")}
              >
                <div className={cn("flex min-w-0 flex-col gap-1")}>
                  <div className={cn("flex min-w-0 flex-wrap items-center gap-2")}>
                    <span className={cn("min-w-0 truncate font-semibold text-russian-violet")}>
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
                  <span className={cn("text-xs break-all text-slate-500")}>{b.email}</span>
                  {b.phone && <span className={cn("text-xs text-slate-500")}>{b.phone}</span>}
                  <span className={cn("text-xs text-slate-500")}>
                    {formatDateTimeShort(b.startAt)} &ndash; {formatDateTimeShort(b.endAt)}
                  </span>
                  {b.quotedLow != null && b.quotedHigh != null && (
                    <span className={cn("text-xs text-slate-500")}>
                      <span className={cn("text-slate-400")}>Quoted: </span>${b.quotedLow} &ndash; $
                      {b.quotedHigh}
                    </span>
                  )}
                </div>

                <div className={cn("flex flex-wrap gap-2 sm:shrink-0")}>
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
                            "rounded-lg bg-russian-violet/10 px-3 py-1.5 text-xs font-medium text-russian-violet transition-colors hover:bg-russian-violet/20",
                          )}
                        >
                          Reschedule
                        </a>
                      )}
                      <button
                        onClick={() => (isExpanded ? setExpandedId(null) : openEdit(b))}
                        className={cn(
                          "rounded-lg bg-russian-violet/10 px-3 py-1.5 text-xs font-medium text-russian-violet transition-colors hover:bg-russian-violet/20",
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
                    Booked on {formatDateTimeShort(b.createdAt)}
                  </p>
                  <div className={cn("grid gap-3 sm:grid-cols-2")}>
                    <label className={cn("flex flex-col gap-1")}>
                      <span className={cn("text-xs font-semibold text-russian-violet")}>Name</span>
                      <input
                        className={cn(
                          "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none",
                        )}
                        value={edit.name}
                        onChange={(e) => setField(b.id, "name", e.target.value)}
                      />
                    </label>
                    <label className={cn("flex flex-col gap-1")}>
                      <span className={cn("text-xs font-semibold text-russian-violet")}>Email</span>
                      <input
                        type="email"
                        className={cn(
                          "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none",
                        )}
                        value={edit.email}
                        onChange={(e) => setField(b.id, "email", e.target.value)}
                      />
                    </label>
                    <label className={cn("flex flex-col gap-1")}>
                      <span className={cn("text-xs font-semibold text-russian-violet")}>Phone</span>
                      <input
                        type="tel"
                        className={cn(
                          "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none",
                        )}
                        value={edit.phone}
                        onChange={(e) => setField(b.id, "phone", e.target.value)}
                        placeholder="Phone number"
                      />
                    </label>
                  </div>

                  {edit.address !== undefined && edit.address !== "" && (
                    <div className={cn("flex flex-col gap-1")}>
                      <span className={cn("text-xs font-semibold text-russian-violet")}>
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
                    <span className={cn("text-xs font-semibold text-russian-violet")}>Notes</span>
                    <textarea
                      className={cn(
                        "min-h-25 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none",
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
                        "rounded-lg bg-russian-violet px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-russian-violet/90 disabled:opacity-50",
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

                    {b.status !== "cancelled" && (
                      <>
                        <button
                          onClick={() => {
                            if (
                              confirm(
                                "Cancel this booking on my end? No fee will be charged to the customer.",
                              )
                            ) {
                              void changeStatus(b.id, "cancelled", "operator");
                            }
                          }}
                          disabled={isSaving}
                          className={cn(
                            "rounded-lg bg-slate-200 px-4 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-300 disabled:opacity-50",
                          )}
                          title="Operator cancel (sick, scheduling clash, etc.) - never charges the customer"
                        >
                          Cancel (my call)
                        </button>
                        <button
                          onClick={() => {
                            if (
                              confirm(
                                "Cancel for the customer? The standard cancellation fee rules will apply (callout + travel inside the fee windows).",
                              )
                            ) {
                              void changeStatus(b.id, "cancelled", "on-behalf");
                            }
                          }}
                          disabled={isSaving}
                          className={cn(
                            "rounded-lg bg-red-500/20 px-4 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/30 disabled:opacity-50",
                          )}
                          title="Customer-initiated cancel they phoned/emailed in - uses the standard fee rules"
                        >
                          Cancel for customer
                        </button>
                        {new Date(b.startAt).getTime() < renderedAt && (
                          <button
                            onClick={() => {
                              if (
                                confirm(
                                  "Mark as no-show? A draft invoice will be created for the call-out fee plus round-trip travel.",
                                )
                              ) {
                                void markNoShow(b.id);
                              }
                            }}
                            disabled={isSaving}
                            className={cn(
                              "rounded-lg bg-amber-500/20 px-4 py-2 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/30 disabled:opacity-50",
                            )}
                            title="Customer didn't show up - bills the full call-out + travel"
                          >
                            Mark no-show
                          </button>
                        )}
                      </>
                    )}

                    {(b.status === "confirmed" || b.status === "completed") && (
                      <button
                        onClick={() => void resendReview(b.id)}
                        disabled={isSaving || isResending}
                        className={cn(
                          "rounded-lg bg-moonstone-600/15 px-4 py-2 text-xs font-medium text-moonstone-700 transition-colors hover:bg-moonstone-600/25 disabled:opacity-50",
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
