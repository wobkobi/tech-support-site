"use client";
// src/features/business/components/PromosView.tsx
/**
 * @description Admin promo CRUD - form-on-top + table-below + overlap warning.
 */

import type { PromoRow } from "@/app/admin/(shell)/promos/page";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { StatusPill, type StatusTone } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { formatNZD } from "@/features/business/lib/business";
import { pickWinningPromo } from "@/features/business/lib/promos";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";
import { useEffect, useState } from "react";

/** Shared classes for the promo form inputs. */
const inputClass =
  "rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:ring-2 focus:ring-russian-violet/30 focus:outline-none";

type PromoType = "flat" | "percent" | "fixed" | "travel";

/** Form type > the column the API stores it under. */
const DISCOUNT_TYPE: Record<PromoType, "flat_hourly" | "percent" | "fixed_amount" | "free_travel"> =
  {
    flat: "flat_hourly",
    percent: "percent",
    fixed: "fixed_amount",
    travel: "free_travel",
  };

/** What the amount field means for each type, shown beside the input. */
const AMOUNT_LABEL: Record<PromoType, string> = {
  flat: "Hourly rate ($/hr)",
  percent: "Discount (%)",
  fixed: "Amount off ($)",
  travel: "Travel discount (%)",
};

/**
 * The form type a stored promo corresponds to. Falls back to the value columns
 * for rows written before discountType existed.
 * @param p - Stored promo row.
 * @returns The matching form type.
 */
function promoTypeOf(p: PromoRow): PromoType {
  if (p.discountType === "fixed_amount") return "fixed";
  if (p.discountType === "free_travel") return "travel";
  if (p.discountType === "flat_hourly") return "flat";
  if (p.discountType === "percent") return "percent";
  return p.flatHourlyRate !== null ? "flat" : "percent";
}

/**
 * The number to show in the amount field for a stored promo, in the units the
 * operator types rather than the units the column stores.
 * @param p - Stored promo row.
 * @returns The amount, or an empty string when the promo has no value set.
 */
function amountFor(p: PromoRow): number | string {
  switch (promoTypeOf(p)) {
    case "flat":
      return p.flatHourlyRate ?? "";
    case "percent":
      return p.percentDiscount !== null ? Math.round(p.percentDiscount * 100) : "";
    case "fixed":
      return p.fixedAmount ?? "";
    case "travel":
      // Stored as the fraction still charged; shown as the discount.
      return p.travelPercent !== null ? Math.round((1 - p.travelPercent) * 100) : "";
  }
}

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
  /** Higher wins when windows overlap. Held as a string for the input. */
  priority: string;
  /** Automatic promos apply to everyone; a code promo only to whoever enters it. */
  kind: "automatic" | "code";
  /** The code, uppercase. Ignored when the kind is automatic. */
  code: string;
}

/**
 * ISO timestamp > "YYYY-MM-DD" (local date parts) for <input type="date">.
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
 * YYYY-MM-DD > ISO timestamp at local-midnight (start of day).
 * @param date - YYYY-MM-DD string.
 * @returns ISO timestamp.
 */
function startOfDayISO(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}

/**
 * YYYY-MM-DD > ISO timestamp at start of next day (so end is inclusive).
 * @param date - YYYY-MM-DD string.
 * @returns ISO timestamp.
 */
function endOfDayISO(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/**
 * `endAt` ISO > inclusive YYYY-MM-DD (subtracts the day added on save).
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
    priority: "0",
    kind: "automatic",
    code: "",
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
 * StatusPill tone for a promo lifecycle status.
 * @param status - Lifecycle status.
 * @returns The pill tone.
 */
function statusTone(status: Status): StatusTone {
  switch (status) {
    case "active":
      return "success";
    case "upcoming":
      return "info";
    case "expired":
      return "neutral";
    case "disabled":
      return "warning";
  }
}

/**
 * Title-cases a status for display.
 * @param status - Lifecycle status.
 * @returns Capitalised label.
 */
function statusLabel(status: Status): string {
  return status[0].toUpperCase() + status.slice(1);
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
 *
 * Compared within a kind only. A code promo and an automatic one can share a
 * window without competing - a valid code always wins, and only for whoever
 * entered it - so pairing them would raise a warning about nothing.
 * @param promos - All promos.
 * @returns Set of overlapping IDs.
 */
function findOverlaps(promos: PromoRow[]): { ids: Set<string>; winners: Map<string, string> } {
  const ids = new Set<string>();
  const winners = new Map<string, string>();
  const active = promos.filter((p) => p.isActive);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (active[i].kind !== active[j].kind) continue;
      if (!rangesOverlap(active[i], active[j])) continue;
      ids.add(active[i].id);
      ids.add(active[j].id);
      // Resolved through the shared selector, and on createdAt rather than
      // startAt, so the warning can never name a different winner than the
      // query that actually picks the promo.
      const winner = pickWinningPromo([
        {
          id: active[i].id,
          priority: active[i].priority,
          createdAt: new Date(active[i].createdAt),
        },
        {
          id: active[j].id,
          priority: active[j].priority,
          createdAt: new Date(active[j].createdAt),
        },
      ]);
      if (winner) {
        winners.set(active[i].id, winner.id);
        winners.set(active[j].id, winner.id);
      }
    }
  }
  return { ids, winners };
}

/** Redemption totals for one promo, as returned by the stats endpoint. */
interface PromoStats {
  redemptions: number;
  totalDiscount: number;
  unvaluedRedemptions: number;
  lastRedeemedAt: string | null;
}

/**
 * One-line usage summary for a promo.
 *
 * Reports rows with no recorded value separately rather than counting them as
 * zero: a promo redeemed before value tracking would otherwise read as "$0
 * discounted", which looks like a promo nobody benefited from.
 * @param stats - Totals for this promo, or undefined when it has none.
 * @returns A sentence describing usage.
 */
function usageNote(stats: PromoStats | undefined): string {
  if (!stats || stats.redemptions === 0) return "Not used yet.";
  const times = `Used ${stats.redemptions} time${stats.redemptions === 1 ? "" : "s"}`;
  if (stats.unvaluedRedemptions === stats.redemptions) {
    return `${times} - discount value not recorded.`;
  }
  const money = formatNZD(stats.totalDiscount);
  if (stats.unvaluedRedemptions > 0) {
    return `${times} - ${money} discounted (${stats.unvaluedRedemptions} before value tracking).`;
  }
  return `${times} - ${money} discounted.`;
}

/**
 * Phrase for a promo caught in an overlap: which promo actually wins, or that
 * this one does. Empty when the promo overlaps nothing.
 * @param promo - The promo being rendered.
 * @param winners - Winning promo id per overlapping promo id.
 * @param all - Every promo, for resolving the winner's title.
 * @returns A sentence, or an empty string when there is no clash.
 */
function overlapNote(promo: PromoRow, winners: Map<string, string>, all: PromoRow[]): string {
  const winnerId = winners.get(promo.id);
  if (!winnerId) return "";
  if (winnerId === promo.id) return "Overlaps another promo - this one wins.";
  const winner = all.find((p) => p.id === winnerId);
  return `Overlaps another promo - ${winner ? winner.title : "the other"} wins.`;
}

/**
 * Short operator-facing description of what a promo does, used by both the
 * table and the mobile card so the two cannot drift.
 * @param p - Stored promo row.
 * @returns A phrase like "$60.00/hr" or "Free travel".
 */
function describeDiscount(p: PromoRow): string {
  switch (promoTypeOf(p)) {
    case "flat":
      return p.flatHourlyRate !== null ? `${formatNZD(p.flatHourlyRate)}/hr` : "-";
    case "percent":
      return p.percentDiscount !== null ? `${Math.round(p.percentDiscount * 100)}% off` : "-";
    case "fixed":
      return p.fixedAmount !== null ? `${formatNZD(p.fixedAmount)} off` : "-";
    case "travel":
      if (p.travelPercent === null) return "-";
      return p.travelPercent === 0
        ? "Free travel"
        : `${Math.round((1 - p.travelPercent) * 100)}% off travel`;
  }
}

/** Props for {@link CodeChip}. */
interface CodeChipProps {
  /** The promo the chip describes. */
  promo: PromoRow;
}

/**
 * Marks a promo as code-only, showing the code itself.
 *
 * Without it a code promo reads as broken in the list: it says Active while the
 * banner stays silent and the pricing page quotes standard rates, which is
 * correct but looks like a bug.
 * @param props - Component props.
 * @param props.promo - The promo the chip describes.
 * @returns The chip, or null for an automatic promo.
 */
function CodeChip({ promo }: CodeChipProps): React.ReactElement | null {
  if (promo.kind !== "code" || !promo.code) return null;
  return (
    <span className="mt-1 inline-block rounded bg-admin-bg px-1.5 py-0.5 text-xs font-semibold tracking-wider text-admin-muted">
      Code only: {promo.code}
    </span>
  );
}

interface Props {
  /** Initial server-fetched promo list. */
  initial: PromoRow[];
}

/**
 * Promos manager - list, add, edit, toggle, delete.
 * @param props - Component props.
 * @param props.initial - Initial promo list.
 * @returns Promos view element.
 */
export function PromosView({ initial }: Props): React.ReactElement {
  const [promos, setPromos] = useState<PromoRow[]>(initial);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState<PromoRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { ids: overlaps, winners: overlapWinners } = findOverlaps(promos);
  const [stats, setStats] = useState<Record<string, PromoStats>>({});

  useEffect(() => {
    fetch("/api/business/promos/stats")
      .then((r) => r.json())
      .then((d: { ok: boolean; stats?: Record<string, PromoStats> }) => {
        if (d.ok && d.stats) setStats(d.stats);
        else toast("Couldn't load promo usage.", { tone: "error" });
      })
      .catch(() => toast("Couldn't load promo usage.", { tone: "error" }));
  }, [toast]);

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
      type: promoTypeOf(p),
      amount: String(amountFor(p)),
      isActive: p.isActive,
      priority: String(p.priority),
      kind: p.kind,
      code: p.code ?? "",
    });
  }

  /**
   * POST/PATCH the form, swap into local state on success.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
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
    if (form.kind === "code" && !form.code.trim()) {
      setError("A code promo needs a code.");
      return;
    }
    const body = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      // Widen day-level inputs: end is start-of-next-day so it's inclusive.
      startAt: startOfDayISO(form.startDate),
      endAt: endOfDayISO(form.endDate),
      // Send only the column that matches the selected type; the route
      // validates per type and rejects anything half-filled.
      discountType: DISCOUNT_TYPE[form.type],
      flatHourlyRate: form.type === "flat" ? amount : null,
      percentDiscount: form.type === "percent" ? amount / 100 : null,
      fixedAmount: form.type === "fixed" ? amount : null,
      // The operator enters "% off travel"; the column stores the fraction
      // still charged, so 100% off is 0.
      travelPercent: form.type === "travel" ? 1 - amount / 100 : null,
      isActive: form.isActive,
      priority: parseInt(form.priority, 10) || 0,
      kind: form.kind,
      // Always sent, including as null for automatic, so switching a promo back
      // to automatic clears the code it used to carry.
      code: form.kind === "code" ? form.code.trim() : null,
    };

    setBusy(true);
    try {
      const url = editingId ? `/api/business/promos/${editingId}` : "/api/business/promos";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? `Save failed (${res.status})`);
        return;
      }
      const d = (await res.json()) as { ok: boolean; promo: PromoRow };
      const next = d.promo;
      setPromos((prev) => {
        if (editingId) return prev.map((p) => (p.id === editingId ? next : p));
        return [next, ...prev];
      });
      toast(editingId ? "Promo updated." : "Promo created.", { tone: "success" });
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !p.isActive }),
    });
    if (!res.ok) {
      toast("Couldn't update the promo.", { tone: "error" });
      return;
    }
    const d = (await res.json()) as { ok: boolean; promo: PromoRow };
    setPromos((prev) => prev.map((x) => (x.id === p.id ? d.promo : x)));
    // `p` is the pre-toggle row, so the new state is the opposite of p.isActive.
    toast(p.isActive ? "Promo disabled." : "Promo enabled.", { tone: "success" });
  }

  /** Deletes the promo held in the confirm dialog. Past invoices keep their snapshot. */
  async function deletePromo(): Promise<void> {
    const p = confirmDelete;
    if (!p) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/business/promos/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setPromos((prev) => prev.filter((x) => x.id !== p.id));
      if (editingId === p.id) resetForm();
      setConfirmDelete(null);
      toast("Promo deleted.", { tone: "success" });
    } catch {
      toast("Couldn't delete the promo.", { tone: "error" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Inline form */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="space-y-3 rounded-xl border border-admin-border bg-admin-surface p-5 shadow-sm"
      >
        <h2 className="text-sm font-semibold text-russian-violet">
          {editingId ? "Edit promo" : "New promo"}
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-admin-muted">Title</span>
            <input
              type="text"
              required
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="e.g. Soft launch"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-admin-muted">Description (optional)</span>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Shown on the pricing page"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-admin-muted">Starts</span>
            <input
              type="date"
              required
              value={form.startDate}
              onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-admin-muted">Ends (inclusive)</span>
            <input
              type="date"
              required
              value={form.endDate}
              onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-admin-muted">Type</span>
            <select
              value={form.type}
              onChange={(e) =>
                setForm((p) => ({ ...p, type: e.target.value as PromoType, amount: "" }))
              }
              className={inputClass}
            >
              <option value="flat">Flat $/hr</option>
              <option value="percent">% off the job</option>
              <option value="fixed">$ off the job</option>
              <option value="travel">% off travel</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-admin-muted">{AMOUNT_LABEL[form.type]}</span>
            <input
              type="number"
              required
              min="0"
              step={form.type === "flat" || form.type === "fixed" ? "0.01" : "1"}
              // A travel discount may be the full 100%; a job discount of 100%
              // would be a free job, which is a mistake rather than an offer.
              max={form.type === "percent" ? 99 : form.type === "travel" ? 100 : undefined}
              value={form.amount}
              onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
              placeholder={form.type === "flat" ? "50" : form.type === "fixed" ? "20" : "20"}
              className={inputClass}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-start gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-admin-muted">Who gets it</span>
            <select
              value={form.kind}
              onChange={(e) =>
                setForm((p) => ({ ...p, kind: e.target.value as "automatic" | "code" }))
              }
              className={cn(inputClass, "w-56")}
            >
              <option value="automatic">Everyone (automatic)</option>
              <option value="code">Only with a code</option>
            </select>
            <span className="text-xs text-admin-faint">
              {form.kind === "code"
                ? "Never shown on the banner or the pricing page - only someone with the code gets it."
                : "Applies to every visitor and shows on the site-wide banner."}
            </span>
          </label>

          {form.kind === "code" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-admin-muted">Code</span>
              <input
                type="text"
                required
                value={form.code}
                // Uppercased as it is typed, because that is how it is stored
                // and compared - what the operator sees is what a customer
                // has to enter.
                onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                placeholder="SPRING25"
                maxLength={32}
                autoComplete="off"
                spellCheck={false}
                className={cn(inputClass, "w-48 tracking-wider uppercase")}
              />
              <span className="text-xs text-admin-faint">
                Letters, numbers and dashes. 3 to 32 characters.
              </span>
            </label>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-admin-muted">Priority</span>
          <input
            type="number"
            step={1}
            value={form.priority}
            onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
            className={cn(inputClass, "w-32")}
          />
          <span className="text-xs text-admin-faint">
            Higher wins when two promos overlap. Ties go to the newer one.
          </span>
        </label>

        <label className="flex items-center gap-2 text-sm text-admin-muted">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
            className="h-4 w-4"
          />
          Active (uncheck to keep the promo on file but pause it)
        </label>

        {error && (
          <p className="rounded bg-coquelicot-500/10 px-3 py-2 text-xs text-coquelicot-500">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <AdminButton type="submit" busy={busy}>
            {editingId ? "Update promo" : "Create promo"}
          </AdminButton>
          {editingId && (
            <AdminButton type="button" variant="secondary" onClick={resetForm}>
              Cancel
            </AdminButton>
          )}
        </div>
      </form>

      {/* Overlap warning */}
      {overlaps.size > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <strong>Heads up:</strong> {overlaps.size} active promos have overlapping date ranges.
          Only one applies at a time - the highest priority wins, then the newer one. Customers will
          see whichever was created most recently. Consider disabling or shortening one to avoid
          surprise behaviour.
        </div>
      )}

      {/* Promo list */}
      {promos.length === 0 ? (
        <p className="rounded-xl border border-admin-border bg-admin-surface p-6 text-sm text-admin-faint">
          No promos yet. Create one above to surface an offer in the site banner, pricing wizard,
          and admin calculator.
        </p>
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-xl border border-admin-border bg-admin-surface shadow-sm sm:block">
            <table className="w-full text-sm">
              <thead className="bg-admin-bg text-xs text-admin-muted uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Title</th>
                  <th className="px-4 py-2 text-left">Period</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-admin-border">
                {promos.map((p) => {
                  const status = getStatus(p);
                  const overlapping = overlaps.has(p.id);
                  return (
                    <tr key={p.id} className={cn(overlapping && "bg-amber-50/50")}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-admin-text">{p.title}</p>
                        {p.description && (
                          <p className="text-xs text-admin-faint">{p.description}</p>
                        )}
                        <CodeChip promo={p} />
                        <p className="text-xs text-admin-muted">{usageNote(stats[p.id])}</p>
                        {overlapping && (
                          <p className="text-xs font-medium text-amber-700">
                            {overlapNote(p, overlapWinners, promos)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-admin-muted">
                        {formatDateShort(p.startAt)} -{" "}
                        {formatDateShort(endIsoToInclusiveDate(p.endAt))}
                      </td>
                      <td className="px-4 py-3 text-xs text-admin-text">{describeDiscount(p)}</td>
                      <td className="px-4 py-3">
                        <StatusPill tone={statusTone(status)}>{statusLabel(status)}</StatusPill>
                      </td>
                      <td className="px-4 py-3 text-right text-xs">
                        <div className="flex justify-end gap-3">
                          <button
                            onClick={() => void toggleActive(p)}
                            className="text-admin-muted hover:text-admin-text"
                          >
                            {p.isActive ? "Disable" : "Enable"}
                          </button>
                          <button
                            onClick={() => startEdit(p)}
                            className="text-admin-muted hover:text-admin-text"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setConfirmDelete(p)}
                            className="text-coquelicot-500 hover:text-coquelicot-400"
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
          <div className="space-y-3 sm:hidden">
            {promos.map((p) => {
              const status = getStatus(p);
              const overlapping = overlaps.has(p.id);
              return (
                <div
                  key={p.id}
                  className={cn(
                    "rounded-xl border border-admin-border bg-admin-surface p-4 shadow-sm",
                    overlapping && "border-amber-300 bg-amber-50/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold text-admin-text">{p.title}</p>
                      {p.description && (
                        <p className="mt-0.5 text-sm text-admin-muted">{p.description}</p>
                      )}
                      <CodeChip promo={p} />
                      <p className="mt-0.5 text-sm text-admin-muted">{usageNote(stats[p.id])}</p>
                      {overlapping && (
                        <p className="mt-0.5 text-sm font-medium text-amber-700">
                          {overlapNote(p, overlapWinners, promos)}
                        </p>
                      )}
                    </div>
                    <StatusPill tone={statusTone(status)} className="shrink-0">
                      {statusLabel(status)}
                    </StatusPill>
                  </div>

                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-admin-faint">Period</dt>
                    <dd className="text-admin-text">
                      {formatDateShort(p.startAt)} -{" "}
                      {formatDateShort(endIsoToInclusiveDate(p.endAt))}
                    </dd>
                    <dt className="text-admin-faint">Type</dt>
                    <dd className="text-admin-text">{describeDiscount(p)}</dd>
                  </dl>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <AdminButton variant="secondary" onClick={() => void toggleActive(p)}>
                      {p.isActive ? "Disable" : "Enable"}
                    </AdminButton>
                    <AdminButton variant="secondary" onClick={() => startEdit(p)}>
                      Edit
                    </AdminButton>
                    <AdminButton variant="danger" onClick={() => setConfirmDelete(p)}>
                      Delete
                    </AdminButton>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete this promo?"
        body={
          confirmDelete
            ? `"${confirmDelete.title}" is removed everywhere it shows. Past invoices keep their snapshot.`
            : undefined
        }
        confirmLabel="Delete"
        tone="danger"
        busy={deleting}
        onConfirm={() => void deletePromo()}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
