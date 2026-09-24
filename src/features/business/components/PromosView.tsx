"use client";
// src/features/business/components/PromosView.tsx
// Admin promo CRUD - form-on-top + table-below + overlap warning.

import type { PromoRow } from "@/app/admin/(shell)/promos/page";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { StatusPill, type StatusTone } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { PromoAdvancedOptions } from "@/features/business/components/PromoAdvancedOptions";
import {
  PromoPricePreview,
  type PromoPreviewRates,
} from "@/features/business/components/PromoPricePreview";
import { formatNZD } from "@/features/business/lib/business";
import {
  advancedChips,
  AMOUNT_LABEL,
  DISCOUNT_TYPE,
  discountColumns,
  emptyForm,
  endIsoToInclusiveDate,
  endOfDayISO,
  formFromPromo,
  previewPromo,
  PROMO_INPUT_CLASS,
  promoTypeOf,
  startOfDayISO,
  toDateInput,
  toMinuteOfDay,
  type FormState,
  type PromoType,
} from "@/features/business/lib/promo-form";
import {
  describeRecurringWindow,
  pickWinningPromo,
  summariseForBanner,
} from "@/features/business/lib/promos";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import React, { useEffect, useRef, useState } from "react";
import { FaPlus } from "react-icons/fa6";

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
  return status[0]!.toUpperCase() + status.slice(1);
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
  if (aStart >= bEnd || bStart >= aEnd) return false;
  // Sharing a date range is not competing if they run on different days. A
  // Tuesday promo and a Thursday one never meet, and warning about them would
  // train the operator to ignore the warning that matters.
  if (a.activeWeekdays.length > 0 && b.activeWeekdays.length > 0) {
    return a.activeWeekdays.some((d) => b.activeWeekdays.includes(d));
  }
  return true;
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
      const a = active[i]!;
      const b = active[j]!;
      if (a.kind !== b.kind) continue;
      if (!rangesOverlap(a, b)) continue;
      ids.add(a.id);
      ids.add(b.id);
      // Resolved through the shared selector, and on createdAt rather than
      // startAt, so the warning can never name a different winner than the
      // query that actually picks the promo.
      const winner = pickWinningPromo([
        {
          id: a.id,
          priority: a.priority,
          createdAt: new Date(a.createdAt),
        },
        {
          id: b.id,
          priority: b.priority,
          createdAt: new Date(b.createdAt),
        },
      ]);
      if (winner) {
        winners.set(a.id, winner.id);
        winners.set(b.id, winner.id);
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

/** Props for {@link PromoStatsBlock}. */
interface PromoStatsBlockProps {
  /** The promo being reported on. */
  promo: PromoRow;
  /** Its redemption totals, or undefined when it has none. */
  stats: PromoStats | undefined;
}

/**
 * Usage detail for one promo: how often it was redeemed, what it gave away, and
 * how much of its cap is left.
 *
 * Deliberately answers only what the redemption rows can support. Whether the
 * promo caused the bookings is not knowable from this data, and a number
 * implying it were would be worse than no number.
 * @param props - Component props.
 * @param props.promo - The promo being reported on.
 * @param props.stats - Its redemption totals.
 * @returns The stats block.
 */
function PromoStatsBlock({ promo, stats }: PromoStatsBlockProps): React.ReactElement {
  const used = stats?.redemptions ?? 0;
  const rows: [string, string][] = [["Redemptions", String(used)]];

  if (promo.maxRedemptions != null) {
    const left = Math.max(0, promo.maxRedemptions - used);
    rows.push([
      "Cap",
      `${used} of ${promo.maxRedemptions} used, ${left} left${left === 0 ? " - the promo will no longer apply" : ""}`,
    ]);
  }
  if (promo.perCustomerLimit != null) {
    rows.push(["Per customer", `${promo.perCustomerLimit} max`]);
  }

  // Unvalued rows are called out rather than counted as zero: a redemption
  // recorded before the value was tracked is not a discount of nothing.
  if (used > 0) {
    const valued = used - (stats?.unvaluedRedemptions ?? 0);
    rows.push([
      "Discount given",
      valued > 0
        ? `${formatNZD(stats?.totalDiscount ?? 0)} across ${valued} of them`
        : "not recorded on any of them",
    ]);
    if (stats?.lastRedeemedAt) {
      rows.push(["Last used", formatDateShort(stats.lastRedeemedAt)]);
    }
  }

  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-admin-bg px-3 py-2 text-xs">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-admin-faint">{label}</dt>
          <dd className="text-admin-text">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** Props for {@link PromoChips}. */
interface PromoChipsProps {
  /** The promo the chips describe. */
  promo: PromoRow;
}

/**
 * Marks everything that narrows a promo below "applies to everyone, always".
 *
 * Without these a restricted promo reads as broken in the list: it says Active
 * while the banner stays silent or the discount only lands on some jobs, which
 * is correct but looks like a bug.
 * @param props - Component props.
 * @param props.promo - The promo the chips describe.
 * @returns The chip row, or null when nothing narrows the promo.
 */
function PromoChips({ promo }: PromoChipsProps): React.ReactElement | null {
  const chips: string[] = [];
  if (promo.kind === "code" && promo.code) chips.push(`Code only: ${promo.code}`);
  // Shared with the customer-facing banner so the operator reads the same
  // wording the customer will.
  const window = describeRecurringWindow(promo);
  if (window) chips.push(window);
  if (promo.tiers.length > 0) chips.push(`${promo.tiers.length} spend tiers`);
  else if (promo.minSpend != null) chips.push(`Jobs over $${promo.minSpend}`);
  if (promo.newCustomersOnly) chips.push("New customers only");
  if (promo.maxRedemptions != null) chips.push(`${promo.maxRedemptions} uses total`);
  if (promo.perCustomerLimit != null) chips.push(`${promo.perCustomerLimit} per customer`);
  if (chips.length === 0) return null;

  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded bg-admin-bg px-1.5 py-0.5 text-xs font-semibold text-admin-muted"
        >
          {chip}
        </span>
      ))}
    </span>
  );
}
interface Props {
  /** Initial server-fetched promo list. */
  initial: PromoRow[];
  /** Live rates the price preview discounts. */
  rates: PromoPreviewRates;
}

/**
 * Promos manager - list, add, edit, toggle, delete.
 * @param props - Component props.
 * @param props.initial - Initial promo list.
 * @param props.rates - Live rates for the price preview.
 * @returns Promos view element.
 */
export function PromosView({ initial, rates }: Props): React.ReactElement {
  const [promos, setPromos] = useState<PromoRow[]>(initial);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState<PromoRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Phones only: the form starts folded so the promo list isn't a long form
  // away. lg+ always shows it.
  const [formOpen, setFormOpen] = useState(false);
  // Held in state rather than derived, so clearing the last advanced field
  // while typing doesn't snap the section shut under the cursor.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const { ids: overlaps, winners: overlapWinners } = findOverlaps(promos);
  const [stats, setStats] = useState<Record<string, PromoStats>>({});
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  // Ids whose stats block is open. Collapsed by default so the list stays
  // scannable when most promos have nothing interesting to report.
  const [openStats, setOpenStats] = useState<Set<string>>(new Set());

  // Overlaps are computed across ALL promos, not the filtered view: a promo
  // hidden by the filter still competes with a visible one, and warning only
  // about what happens to be on screen would be worse than not warning.
  const visiblePromos =
    statusFilter === "all" ? promos : promos.filter((p) => getStatus(p) === statusFilter);
  const statusCounts = promos.reduce<Record<string, number>>((acc, p) => {
    const key = getStatus(p);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  useEffect(() => {
    fetch("/api/business/promos/stats")
      .then((r) => r.json())
      .then((d: { ok: boolean; stats?: Record<string, PromoStats> }) => {
        if (d.ok && d.stats) setStats(d.stats);
        else toast("Couldn't load promo usage.", { tone: "error" });
      })
      .catch(() => toast("Couldn't load promo usage.", { tone: "error" }));
  }, [toast]);

  /**
   * Toggles a promo's stats block.
   * @param id - Promo id.
   */
  function toggleStats(id: string): void {
    setOpenStats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Resets the form back to its blank state, exits edit mode and folds it on phones. */
  function resetForm(): void {
    setForm(emptyForm());
    setEditingId(null);
    setError(null);
    setFormOpen(false);
    setAdvancedOpen(false);
  }

  /**
   * Loads a promo into the form for editing and scrolls up to it, since the
   * row's Edit button sits below the whole form.
   * @param p - Promo row.
   */
  function startEdit(p: PromoRow): void {
    setEditingId(p.id);
    setError(null);
    setFormOpen(true);
    // Next frame: on a phone the form is still hidden until this render lands.
    requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    const next = formFromPromo(p);
    setForm(next);
    setAdvancedOpen(advancedChips(next).length > 0);
  }

  /**
   * Loads a promo into the form as a NEW one.
   *
   * Promos are nearly always a variation on the last, so the whole
   * configuration is carried across - only the title is marked and the dates
   * are pushed forward, since reusing a finished window would create a promo
   * that is already expired.
   * @param p - Promo to copy.
   */
  function startDuplicate(p: PromoRow): void {
    startEdit(p);
    setEditingId(null);
    const today = new Date();
    const weekOut = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    setForm((f) => ({
      ...f,
      title: `${p.title} (copy)`,
      startDate: toDateInput(today.toISOString()),
      endDate: toDateInput(weekOut.toISOString()),
      // A code is unique, so the copy cannot keep it - cleared rather than
      // suffixed, so the operator has to choose one rather than ship "SPRING25-2".
      code: "",
    }));
    setError(null);
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
    // Caught here as well as server-side so the operator is told before the
    // round trip which half of the pair is missing.
    if (Boolean(form.activeFrom) !== Boolean(form.activeTo)) {
      setError("A time-of-day restriction needs both a start and an end.");
      return;
    }
    if (form.tiers.some((t) => !t.minSpend.trim() || !t.amount.trim())) {
      setError("Every tier needs both a spend threshold and an amount.");
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
      ...discountColumns(form.type, amount),
      isActive: form.isActive,
      priority: parseInt(form.priority, 10) || 0,
      kind: form.kind,
      // Always sent, including as null for automatic, so switching a promo back
      // to automatic clears the code it used to carry.
      code: form.kind === "code" ? form.code.trim() : null,
      // Blank means no cap, which is null rather than 0 - the route rejects 0,
      // since a limit of nothing reads as an off switch nobody looks for.
      maxRedemptions: form.maxRedemptions.trim() ? parseInt(form.maxRedemptions, 10) : null,
      perCustomerLimit: form.perCustomerLimit.trim() ? parseInt(form.perCustomerLimit, 10) : null,
      newCustomersOnly: form.newCustomersOnly,
      activeWeekdays: form.activeWeekdays,
      activeFromMinute: toMinuteOfDay(form.activeFrom),
      activeToMinute: toMinuteOfDay(form.activeTo),
      minSpend: form.minSpend.trim() ? parseFloat(form.minSpend) : null,
      // Bands carry the same kind of discount as their parent, built by the
      // same converter.
      tiers: form.tiers.map((t) => ({
        minSpend: parseFloat(t.minSpend),
        ...discountColumns(form.type, parseFloat(t.amount)),
      })),
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
      {!formOpen && (
        <AdminButton className="w-full lg:hidden" onClick={() => setFormOpen(true)}>
          <FaPlus aria-hidden />
          New promo
        </AdminButton>
      )}

      {/* Inline form */}
      <form
        ref={formRef}
        onSubmit={(e) => void handleSubmit(e)}
        className={cn(
          "scroll-mt-16 space-y-3 rounded-xl border border-admin-border bg-admin-surface p-4 shadow-sm sm:p-5",
          !formOpen && "max-lg:hidden",
        )}
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
              className={PROMO_INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-admin-muted">Description (optional)</span>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Shown on the pricing page"
              className={PROMO_INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-admin-muted">Starts</span>
            <input
              type="date"
              required
              value={form.startDate}
              onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
              className={PROMO_INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-admin-muted">Ends (inclusive)</span>
            <input
              type="date"
              required
              value={form.endDate}
              onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
              className={PROMO_INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-admin-muted">Type</span>
            <select
              value={form.type}
              onChange={(e) =>
                setForm((p) => ({ ...p, type: e.target.value as PromoType, amount: "" }))
              }
              className={PROMO_INPUT_CLASS}
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
              step="0.01"
              // A travel discount may be the full 100%; a job discount of 100%
              // would be a free job, which is a mistake rather than an offer.
              max={form.type === "percent" ? 99 : form.type === "travel" ? 100 : undefined}
              value={form.amount}
              onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
              placeholder={form.type === "flat" ? "50" : form.type === "fixed" ? "20" : "20"}
              className={PROMO_INPUT_CLASS}
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
              className={cn(PROMO_INPUT_CLASS, "w-56")}
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
                className={cn(PROMO_INPUT_CLASS, "w-48 tracking-wider uppercase")}
              />
              <span className="text-xs text-admin-faint">
                Letters, numbers and dashes. 3 to 32 characters.
              </span>
            </label>
          )}
        </div>

        <PromoAdvancedOptions
          form={form}
          setForm={setForm}
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
        />

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
          <p className="rounded bg-coquelicot-500/10 px-3 py-2 text-sm text-coquelicot-500">
            {error}
          </p>
        )}

        {/* Rendered by summariseForBanner, the same function the real banner
            calls, so the preview cannot drift from what ships. Across four
            discount types plus tiers, a spend floor and a weekday restriction,
            the wording is no longer obvious from the fields above. */}
        {(() => {
          const preview = previewPromo(form);
          if (!preview) return null;
          return (
            <div className="rounded-xl border border-admin-border bg-admin-bg px-4 py-3">
              <p className="text-xs font-medium text-admin-muted">Customers will see</p>
              <p className="mt-1 text-sm font-semibold text-admin-text">
                ⚡ {summariseForBanner(preview)}
              </p>
              {form.kind === "code" && (
                <p className="mt-1 text-sm text-admin-faint">
                  Not on the banner - a code promo is only ever shown to someone who enters
                  {form.code ? ` ${form.code}` : " the code"}.
                </p>
              )}
            </div>
          );
        })()}

        {(() => {
          const preview = previewPromo(form);
          return preview ? <PromoPricePreview promo={preview} rates={rates} /> : null;
        })()}

        <div className="flex gap-2">
          <AdminButton type="submit" busy={busy}>
            {editingId ? "Update promo" : "Create promo"}
          </AdminButton>
          <AdminButton
            type="button"
            variant="secondary"
            onClick={resetForm}
            className={cn(!editingId && "lg:hidden")}
          >
            Cancel
          </AdminButton>
        </div>
      </form>

      {/* Overlap warning */}
      {overlaps.size > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <strong>Heads up:</strong> {overlaps.size} active promos have overlapping date ranges.
          Only one applies at a time - the highest priority wins, then the newer one. Each row below
          names which promo actually wins. Consider disabling or shortening one to avoid surprise
          behaviour.
        </div>
      )}

      {/* Status filter. Counts come from the full list, so a zero is visible
          rather than the tab simply being absent. */}
      {promos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(["all", "active", "upcoming", "expired", "disabled"] as const).map((key) => {
            const count = key === "all" ? promos.length : (statusCounts[key] ?? 0);
            const selected = statusFilter === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                onClick={() => setStatusFilter(key)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium capitalize",
                  selected
                    ? "border-admin-text bg-admin-text text-admin-surface"
                    : "border-admin-border bg-admin-surface text-admin-muted hover:bg-admin-bg",
                )}
              >
                {key} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Promo list */}
      {promos.length === 0 ? (
        <p className="rounded-xl border border-admin-border bg-admin-surface p-6 text-sm text-admin-faint">
          No promos yet. Create one above to surface an offer in the site banner, pricing wizard,
          and admin calculator.
        </p>
      ) : visiblePromos.length === 0 ? (
        <p className="rounded-xl border border-admin-border bg-admin-surface p-6 text-sm text-admin-faint">
          No {statusFilter} promos. Pick another filter to see the rest.
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
                {visiblePromos.map((p) => {
                  const status = getStatus(p);
                  const overlapping = overlaps.has(p.id);
                  return (
                    <tr key={p.id} className={cn(overlapping && "bg-amber-50/50")}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-admin-text">{p.title}</p>
                        {p.description && (
                          <p className="text-xs text-admin-faint">{p.description}</p>
                        )}
                        <PromoChips promo={p} />
                        <button
                          type="button"
                          onClick={() => toggleStats(p.id)}
                          aria-expanded={openStats.has(p.id)}
                          className="text-left text-xs text-admin-muted underline decoration-dotted hover:text-admin-text"
                        >
                          {usageNote(stats[p.id])}
                        </button>
                        {openStats.has(p.id) && <PromoStatsBlock promo={p} stats={stats[p.id]} />}
                        {overlapping && (
                          <p className="text-sm font-medium text-amber-700">
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
                            onClick={() => startDuplicate(p)}
                            className="text-admin-muted hover:text-admin-text"
                          >
                            Duplicate
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
            {visiblePromos.map((p) => {
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
                      <PromoChips promo={p} />
                      <button
                        type="button"
                        onClick={() => toggleStats(p.id)}
                        aria-expanded={openStats.has(p.id)}
                        className="mt-0.5 text-left text-sm text-admin-muted underline decoration-dotted"
                      >
                        {usageNote(stats[p.id])}
                      </button>
                      {openStats.has(p.id) && <PromoStatsBlock promo={p} stats={stats[p.id]} />}
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
                    <AdminButton variant="secondary" onClick={() => startDuplicate(p)}>
                      Duplicate
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
