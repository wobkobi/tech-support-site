"use client";
// src/features/business/components/PromosView.tsx
// Admin promo CRUD - form-on-top + table-below + overlap warning. Holds all the list and
// form state; PromoForm and PromoListRows render the markup.

import type { PromoRow } from "@/app/admin/(shell)/promos/page";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { ListToolbar } from "@/features/admin/components/ui/ListToolbar";
import { useToast } from "@/features/admin/components/ui/Toast";
import { chipClass } from "@/features/business/components/calculator/calculator-classes";
import {
  findOverlaps,
  getStatus,
  type PromoStats,
  type PromoStatus,
} from "@/features/business/components/promo-list-helpers";
import { PromoForm } from "@/features/business/components/PromoForm";
import { PromoListRows } from "@/features/business/components/PromoListRows";
import type { PromoPreviewRates } from "@/features/business/components/PromoPricePreview";
import {
  advancedChips,
  DISCOUNT_TYPE,
  discountColumns,
  emptyForm,
  endOfDayISO,
  formFromPromo,
  startOfDayISO,
  toDateInput,
  toMinuteOfDay,
  type FormState,
} from "@/features/business/lib/promo-form";
import { callApi } from "@/features/mailing/lib/api-client";
import { cn } from "@/shared/lib/cn";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { FaPlus } from "react-icons/fa6";

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
  const [emailingId, setEmailingId] = useState<string | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);
  const router = useRouter();
  // Phones only: the form starts folded so the promo list isn't a long form
  // away. lg+ always shows it.
  const [formOpen, setFormOpen] = useState(false);
  // Held in state rather than derived, so clearing the last advanced field
  // while typing doesn't snap the section shut under the cursor.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const { ids: overlaps, winners: overlapWinners } = findOverlaps(promos);
  const [stats, setStats] = useState<Record<string, PromoStats>>({});
  const [statusFilter, setStatusFilter] = useState<PromoStatus | "all">("all");
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

  /**
   * Starts a mailing-list draft from the promo preset, linked to this promo, and
   * opens it in the email editor.
   * @param p - Running automatic promo to advertise.
   */
  async function emailPromo(p: PromoRow): Promise<void> {
    setEmailingId(p.id);
    const res = await callApi<{ campaign: { id: string } }>("/api/admin/mailing", "POST", {
      source: "promo",
      promoId: p.id,
    });
    if (!res.ok) {
      setEmailingId(null);
      toast(res.error, { tone: "error" });
      return;
    }
    router.push(`/admin/mailing/${res.campaign.id}`);
  }

  /**
   * Starts a social post draft from the promo preset, linked to this promo, and
   * opens it in the composer.
   * @param p - Running automatic promo to advertise.
   */
  async function postPromo(p: PromoRow): Promise<void> {
    setPostingId(p.id);
    const res = await callApi<{ post: { id: string } }>("/api/admin/social", "POST", {
      source: "promo",
      promoId: p.id,
    });
    if (!res.ok) {
      setPostingId(null);
      toast(res.error, { tone: "error" });
      return;
    }
    router.push(`/admin/social?post=${res.post.id}`);
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

      <PromoForm
        form={form}
        setForm={setForm}
        editingId={editingId}
        busy={busy}
        error={error}
        formOpen={formOpen}
        advancedOpen={advancedOpen}
        onAdvancedOpenChange={setAdvancedOpen}
        formRef={formRef}
        onSubmit={(e) => void handleSubmit(e)}
        onCancel={resetForm}
        rates={rates}
      />

      {/* Overlap warning */}
      {overlaps.size > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Heads up:</strong> {overlaps.size} active promos have overlapping date ranges.
          Only one applies at a time - the highest priority wins, then the newer one. Each row below
          names which promo actually wins. Consider disabling or shortening one to avoid surprise
          behaviour.
        </div>
      )}

      <div>
        {/* Status filter. Counts come from the full list, so a zero is visible
            rather than the tab simply being absent. */}
        {promos.length > 0 && (
          <ListToolbar
            filters={(["all", "active", "upcoming", "expired", "disabled"] as const).map((key) => {
              const count = key === "all" ? promos.length : (statusCounts[key] ?? 0);
              const selected = statusFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setStatusFilter(key)}
                  className={cn(chipClass(selected), "capitalize")}
                >
                  {key} ({count})
                </button>
              );
            })}
          />
        )}

        {/* Promo list */}
        {promos.length === 0 ? (
          <Card padding="none">
            <EmptyState
              title="No promos yet."
              body="Create one above to surface an offer in the site banner, pricing wizard, and admin calculator."
            />
          </Card>
        ) : visiblePromos.length === 0 ? (
          <Card padding="none">
            <EmptyState
              title={`No ${statusFilter} promos.`}
              body="Pick another filter to see the rest."
            />
          </Card>
        ) : (
          <PromoListRows
            visiblePromos={visiblePromos}
            promos={promos}
            overlaps={overlaps}
            overlapWinners={overlapWinners}
            stats={stats}
            openStats={openStats}
            onToggleStats={toggleStats}
            emailingId={emailingId}
            postingId={postingId}
            onEmail={(p) => void emailPromo(p)}
            onPost={(p) => void postPromo(p)}
            onToggleActive={(p) => void toggleActive(p)}
            onEdit={startEdit}
            onDuplicate={startDuplicate}
            onDelete={setConfirmDelete}
          />
        )}
      </div>

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
