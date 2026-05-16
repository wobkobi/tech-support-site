"use client";
// src/features/business/components/PromosView.tsx
/**
 * @file PromosView.tsx
 * @description Admin promo CRUD - form-on-top + table-below + overlap warning.
 */

import { useState } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";
import { formatNZD } from "@/features/business/lib/business";
import { formatDateShort } from "@/shared/lib/date-format";
import type { PromoRow } from "@/app/admin/promos/page";

type PromoType = "flat" | "percent";

interface FormState {
  title: string;
  description: string;
  /** Start date in YYYY-MM-DD form. Internally widened to local-midnight when sent. */
  startDate: string;
  /** End date (inclusive) in YYYY-MM-DD form. Internally widened to start-of-next-day. */
  endDate: string;
  type: PromoType;
  amount: string;
  isActive: boolean;
}

/**
 * ISO timestamp -> "YYYY-MM-DD" (local date parts) for <input type="date">.
 * @param iso - ISO 8601 timestamp.
 * @returns Date-input string, or empty for invalid input.
 */
function toDateInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  /**
   * Left-pads a single digit with a leading zero.
   * @param n - Number to pad.
   * @returns Two-character string.
   */
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * YYYY-MM-DD -> ISO timestamp at local-midnight (start of day).
 * @param date - YYYY-MM-DD string.
 * @returns ISO timestamp.
 */
function startOfDayISO(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}

/**
 * YYYY-MM-DD -> ISO timestamp at start of next day (so end is inclusive).
 * @param date - YYYY-MM-DD string.
 * @returns ISO timestamp.
 */
function endOfDayISO(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/**
 * `endAt` ISO -> inclusive YYYY-MM-DD (subtracts the day we added on save).
 * @param iso - ISO 8601 timestamp.
 * @returns Date-input string.
 */
function endIsoToInclusiveDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() - 1);
  return toDateInput(d.toISOString());
}

/**
 * Empty form pre-populated with today + a week-out end.
 * @returns Default FormState.
 */
function emptyForm(): FormState {
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    title: "",
    description: "",
    startDate: toDateInput(now.toISOString()),
    endDate: toDateInput(nextWeek.toISOString()),
    type: "flat",
    amount: "",
    isActive: true,
  };
}

type Status = "active" | "upcoming" | "expired" | "disabled";

/**
 * Lifecycle bucket for a promo right now.
 * @param p - Promo row.
 * @param now - Reference time.
 * @returns Status badge value.
 */
function getStatus(p: PromoRow, now: Date = new Date()): Status {
  if (!p.isActive) return "disabled";
  const start = new Date(p.startAt);
  const end = new Date(p.endAt);
  if (now < start) return "upcoming";
  if (now >= end) return "expired";
  return "active";
}

/**
 * True when two promo date ranges overlap (half-open).
 * @param a - First promo.
 * @param b - Second promo.
 * @returns Whether they overlap.
 */
function rangesOverlap(a: PromoRow, b: PromoRow): boolean {
  const aStart = new Date(a.startAt).getTime();
  const aEnd = new Date(a.endAt).getTime();
  const bStart = new Date(b.startAt).getTime();
  const bEnd = new Date(b.endAt).getTime();
  return aStart < bEnd && bStart < aEnd;
}

/**
 * IDs of active promos whose ranges overlap each other.
 * @param promos - All promos.
 * @returns Set of overlapping IDs.
 */
function findOverlaps(promos: PromoRow[]): Set<string> {
  const ids = new Set<string>();
  const active = promos.filter((p) => p.isActive);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (rangesOverlap(active[i], active[j])) {
        ids.add(active[i].id);
        ids.add(active[j].id);
      }
    }
  }
  return ids;
}

interface Props {
  /** Admin token for X-Admin-Secret header. */
  token: string;
  /** Initial server-fetched promo list. */
  initial: PromoRow[];
}

/**
 * Promos manager - list, add, edit, toggle, delete.
 * @param props - Component props.
 * @param props.token - Admin token (X-Admin-Secret).
 * @param props.initial - Initial promo list.
 * @returns Promos view element.
 */
export function PromosView({ token, initial }: Props): React.ReactElement {
  const headers: Record<string, string> = { "X-Admin-Secret": token };

  const [promos, setPromos] = useState<PromoRow[]>(initial);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const overlaps = findOverlaps(promos);

  /** Resets the form back to its blank state and exits edit mode. */
  function resetForm(): void {
    setForm(emptyForm());
    setEditingId(null);
    setError(null);
  }

  /**
   * Loads a promo into the form for editing.
   * @param p - Promo row.
   */
  function startEdit(p: PromoRow): void {
    setEditingId(p.id);
    setError(null);
    setForm({
      title: p.title,
      description: p.description ?? "",
      startDate: toDateInput(p.startAt),
      // Stored as start-of-next-day; render the inclusive end date.
      endDate: endIsoToInclusiveDate(p.endAt),
      type: p.flatHourlyRate !== null ? "flat" : "percent",
      amount: String(
        p.flatHourlyRate !== null
          ? p.flatHourlyRate
          : p.percentDiscount !== null
            ? Math.round(p.percentDiscount * 100)
            : "",
      ),
      isActive: p.isActive,
    });
  }

  /**
   * POST/PATCH the form, swap into local state on success.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) {
      setError("Enter a positive amount.");
      return;
    }
    if (form.startDate > form.endDate) {
      setError("Start date must be on or before the end date.");
      return;
    }
    const body = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      // Widen day-level inputs: end is start-of-next-day so it's inclusive.
      startAt: startOfDayISO(form.startDate),
      endAt: endOfDayISO(form.endDate),
      // XOR: send only the field that matches the selected type.
      flatHourlyRate: form.type === "flat" ? amount : null,
      percentDiscount: form.type === "percent" ? amount / 100 : null,
      isActive: form.isActive,
    };

    setBusy(true);
    try {
      const url = editingId ? `/api/business/promos/${editingId}` : "/api/business/promos";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? `Save failed (${res.status})`);
        return;
      }
      const d = (await res.json()) as { ok: boolean; promo: PromoRow };
      const next: PromoRow = {
        ...d.promo,
        // Prisma returns Date objects; serialised via JSON they become strings already.
        startAt: typeof d.promo.startAt === "string" ? d.promo.startAt : d.promo.startAt,
        endAt: typeof d.promo.endAt === "string" ? d.promo.endAt : d.promo.endAt,
      };
      setPromos((prev) => {
        if (editingId) return prev.map((p) => (p.id === editingId ? next : p));
        return [next, ...prev];
      });
      resetForm();
    } finally {
      setBusy(false);
    }
  }

  /**
   * Toggles isActive without entering edit mode.
   * @param p - Promo to toggle.
   */
  async function toggleActive(p: PromoRow): Promise<void> {
    const res = await fetch(`/api/business/promos/${p.id}`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ isActive: !p.isActive }),
    });
    if (!res.ok) return;
    const d = (await res.json()) as { ok: boolean; promo: PromoRow };
    setPromos((prev) => prev.map((x) => (x.id === p.id ? d.promo : x)));
  }

  /**
   * Confirm + delete a promo.
   * @param p - Promo to delete.
   */
  async function deletePromo(p: PromoRow): Promise<void> {
    if (!confirm(`Delete promo "${p.title}"? Past invoices keep their snapshot.`)) return;
    const res = await fetch(`/api/business/promos/${p.id}`, { method: "DELETE", headers });
    if (!res.ok) return;
    setPromos((prev) => prev.filter((x) => x.id !== p.id));
    if (editingId === p.id) resetForm();
  }

  return (
    <div className={cn("space-y-6")}>
      {/* Inline form */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className={cn("space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}
      >
        <h2 className={cn("text-russian-violet text-sm font-semibold")}>
          {editingId ? "Edit promo" : "New promo"}
        </h2>

        <div className={cn("grid gap-3 sm:grid-cols-2")}>
          <label className={cn("flex flex-col gap-1")}>
            <span className={cn("text-xs font-medium text-slate-600")}>Title</span>
            <input
              type="text"
              required
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="e.g. Soft launch"
              className={cn(
                "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
          </label>
          <label className={cn("flex flex-col gap-1")}>
            <span className={cn("text-xs font-medium text-slate-600")}>Description (optional)</span>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Shown on the pricing page"
              className={cn(
                "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
          </label>
          <label className={cn("flex flex-col gap-1")}>
            <span className={cn("text-xs font-medium text-slate-600")}>Starts</span>
            <input
              type="date"
              required
              value={form.startDate}
              onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
          </label>
          <label className={cn("flex flex-col gap-1")}>
            <span className={cn("text-xs font-medium text-slate-600")}>Ends (inclusive)</span>
            <input
              type="date"
              required
              value={form.endDate}
              onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
          </label>
          <label className={cn("flex flex-col gap-1")}>
            <span className={cn("text-xs font-medium text-slate-600")}>Type</span>
            <select
              value={form.type}
              onChange={(e) =>
                setForm((p) => ({ ...p, type: e.target.value as PromoType, amount: "" }))
              }
              className={cn(
                "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            >
              <option value="flat">Flat $/hr</option>
              <option value="percent">% discount</option>
            </select>
          </label>
          <label className={cn("flex flex-col gap-1")}>
            <span className={cn("text-xs font-medium text-slate-600")}>
              {form.type === "flat" ? "Amount ($/hr)" : "Discount (%)"}
            </span>
            <input
              type="number"
              required
              min="0"
              step={form.type === "flat" ? "0.01" : "1"}
              max={form.type === "percent" ? 99 : undefined}
              value={form.amount}
              onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
              placeholder={form.type === "flat" ? "50" : "20"}
              className={cn(
                "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
          </label>
        </div>

        <label className={cn("flex items-center gap-2 text-sm text-slate-600")}>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
            className={cn("h-4 w-4")}
          />
          Active (uncheck to keep the promo on file but pause it)
        </label>

        {error && <p className={cn("rounded bg-red-50 px-3 py-2 text-xs text-red-600")}>{error}</p>}

        <div className={cn("flex gap-2")}>
          <button
            type="submit"
            disabled={busy}
            className={cn(
              "bg-russian-violet rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50",
            )}
          >
            {busy ? "Saving..." : editingId ? "Update promo" : "Create promo"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className={cn(
                "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50",
              )}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {/* Overlap warning */}
      {overlaps.size > 0 && (
        <div
          className={cn(
            "rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800",
          )}
        >
          <strong>Heads up:</strong> {overlaps.size} active promos have overlapping date ranges.
          Customers will see whichever was created most recently. Consider disabling or shortening
          one to avoid surprise behaviour.
        </div>
      )}

      {/* Promo list */}
      {promos.length === 0 ? (
        <p className={cn("rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400")}>
          No promos yet. Create one above to surface an offer in the site banner, pricing wizard,
          and admin calculator.
        </p>
      ) : (
        <>
          {/* Desktop: table */}
          <div
            className={cn(
              "hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:block",
            )}
          >
            <table className={cn("w-full text-sm")}>
              <thead className={cn("bg-slate-50 text-xs uppercase text-slate-500")}>
                <tr>
                  <th className={cn("px-4 py-2 text-left")}>Title</th>
                  <th className={cn("px-4 py-2 text-left")}>Period</th>
                  <th className={cn("px-4 py-2 text-left")}>Type</th>
                  <th className={cn("px-4 py-2 text-left")}>Status</th>
                  <th className={cn("px-4 py-2 text-right")}>Actions</th>
                </tr>
              </thead>
              <tbody className={cn("divide-y divide-slate-100")}>
                {promos.map((p) => {
                  const status = getStatus(p);
                  const overlapping = overlaps.has(p.id);
                  return (
                    <tr key={p.id} className={cn(overlapping && "bg-amber-50/50")}>
                      <td className={cn("px-4 py-3")}>
                        <p className={cn("font-medium text-slate-700")}>{p.title}</p>
                        {p.description && (
                          <p className={cn("text-xs text-slate-400")}>{p.description}</p>
                        )}
                      </td>
                      <td className={cn("px-4 py-3 text-xs text-slate-500")}>
                        {formatDateShort(p.startAt)} – {formatDateShort(p.endAt)}
                      </td>
                      <td className={cn("px-4 py-3 text-xs text-slate-700")}>
                        {p.flatHourlyRate !== null
                          ? `${formatNZD(p.flatHourlyRate)}/hr`
                          : p.percentDiscount !== null
                            ? `${Math.round(p.percentDiscount * 100)}% off`
                            : "-"}
                      </td>
                      <td className={cn("px-4 py-3")}>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-semibold",
                            status === "active" && "bg-green-500/15 text-green-700",
                            status === "upcoming" && "bg-blue-500/15 text-blue-700",
                            status === "expired" && "bg-slate-200 text-slate-500",
                            status === "disabled" && "bg-amber-500/15 text-amber-700",
                          )}
                        >
                          {status[0].toUpperCase() + status.slice(1)}
                        </span>
                      </td>
                      <td className={cn("px-4 py-3 text-right text-xs")}>
                        <div className={cn("flex justify-end gap-3")}>
                          <button
                            onClick={() => void toggleActive(p)}
                            className={cn("text-slate-500 hover:text-slate-700")}
                          >
                            {p.isActive ? "Disable" : "Enable"}
                          </button>
                          <button
                            onClick={() => startEdit(p)}
                            className={cn("text-slate-500 hover:text-slate-700")}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => void deletePromo(p)}
                            className={cn("text-red-500 hover:text-red-700")}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: stacked cards */}
          <div className={cn("space-y-3 sm:hidden")}>
            {promos.map((p) => {
              const status = getStatus(p);
              const overlapping = overlaps.has(p.id);
              return (
                <div
                  key={p.id}
                  className={cn(
                    "rounded-xl border border-slate-200 bg-white p-4 shadow-sm",
                    overlapping && "border-amber-300 bg-amber-50/40",
                  )}
                >
                  <div className={cn("flex items-start justify-between gap-3")}>
                    <div className={cn("min-w-0 flex-1")}>
                      <p className={cn("text-base font-semibold text-slate-700")}>{p.title}</p>
                      {p.description && (
                        <p className={cn("mt-0.5 text-sm text-slate-500")}>{p.description}</p>
                      )}
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                        status === "active" && "bg-green-500/15 text-green-700",
                        status === "upcoming" && "bg-blue-500/15 text-blue-700",
                        status === "expired" && "bg-slate-200 text-slate-500",
                        status === "disabled" && "bg-amber-500/15 text-amber-700",
                      )}
                    >
                      {status[0].toUpperCase() + status.slice(1)}
                    </span>
                  </div>

                  <dl className={cn("mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm")}>
                    <dt className={cn("text-slate-400")}>Period</dt>
                    <dd className={cn("text-slate-700")}>
                      {formatDateShort(p.startAt)} – {formatDateShort(p.endAt)}
                    </dd>
                    <dt className={cn("text-slate-400")}>Type</dt>
                    <dd className={cn("text-slate-700")}>
                      {p.flatHourlyRate !== null
                        ? `${formatNZD(p.flatHourlyRate)}/hr`
                        : p.percentDiscount !== null
                          ? `${Math.round(p.percentDiscount * 100)}% off`
                          : "-"}
                    </dd>
                  </dl>

                  <div className={cn("mt-4 flex flex-wrap gap-2")}>
                    <button
                      onClick={() => void toggleActive(p)}
                      className={cn(
                        "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50",
                      )}
                    >
                      {p.isActive ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={() => startEdit(p)}
                      className={cn(
                        "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50",
                      )}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void deletePromo(p)}
                      className={cn(
                        "rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50",
                      )}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
