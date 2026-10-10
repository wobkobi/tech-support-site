"use client";
// src/features/business/components/assets/AssetsView.tsx
// Client side of the Assets page: summary cards, the write-off rule, the register list,
// and the add/edit, schedule and delete dialogs. The server works out every schedule, so
// a save or delete refreshes the route instead of patching local state.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { StatStrip } from "@/features/admin/components/ui/StatStrip";
import { useToast } from "@/features/admin/components/ui/Toast";
import type { AssetFormTarget } from "@/features/business/components/assets/asset-form-state";
import { AssetFormModal } from "@/features/business/components/assets/AssetFormModal";
import { AssetList } from "@/features/business/components/assets/AssetList";
import { AssetScheduleModal } from "@/features/business/components/assets/AssetScheduleModal";
import { FiledYearWarning } from "@/features/business/components/tax/FiledYearWarning";
import type { AssetPrefill, AssetView, ExpenseOption } from "@/features/business/lib/assets";
import { formatNZD } from "@/features/business/lib/business-format";
import { roundCents, type GstStatus } from "@/features/business/lib/tax";
import type { FiledYearRef } from "@/features/business/lib/tax/snapshot";
import { formatDollars } from "@/features/business/lib/tax/workings";
import { Notice } from "@/shared/components/Notice";
import { useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useMemo, useState } from "react";
import { FaPlus } from "react-icons/fa6";

/** Props for {@link AssetsView}. */
interface AssetsViewProps {
  /** Every asset with its schedule. */
  assets: AssetView[];
  /** Every expense the form can link to. */
  expenseOptions: ExpenseOption[];
  /** Current FY key, e.g. "2026-27". */
  currentFyKey: string;
  /** settings.tax.lowValueThreshold. */
  lowValueThreshold: number;
  /** GST registration, for the form's cost label and hint. */
  gst: GstStatus;
  /** Values from ?fromExpense for a new asset, or null. */
  prefill: AssetPrefill | null;
  /** Asset already linked to the ?fromExpense expense, or null. */
  initialEditId: string | null;
  /** True when ?fromExpense named an expense that doesn't exist. */
  fromExpenseMissing: boolean;
  /** Filed years the edit forms warn about, oldest first. */
  filedYears: readonly FiledYearRef[];
}

/**
 * The dialog the page opens with: the asset ?fromExpense points at, a form filled from
 * that expense, or nothing.
 * @param assets - Every asset.
 * @param prefill - Values from the expense, or null.
 * @param initialEditId - Asset already linked to the expense, or null.
 * @returns The form target, or null for no dialog.
 */
function initialTarget(
  assets: readonly AssetView[],
  prefill: AssetPrefill | null,
  initialEditId: string | null,
): AssetFormTarget | null {
  const linked = initialEditId ? assets.find((a) => a.id === initialEditId) : undefined;
  if (linked) return { mode: "edit", asset: linked };
  return prefill ? { mode: "new", prefill } : null;
}

/**
 * Register order: items still in use first, then disposed ones, each newest first.
 * @param a - First asset.
 * @param b - Second asset.
 * @returns Sort order.
 */
function registerOrder(a: AssetView, b: AssetView): number {
  const disposed = Number(a.disposedAt !== null) - Number(b.disposedAt !== null);
  return disposed !== 0 ? disposed : b.inServiceDate.localeCompare(a.inServiceDate);
}

/**
 * Sums money to the cent through {@link roundCents}.
 * @param values - Amounts.
 * @returns Total rounded to cents.
 */
function sumCents(values: readonly number[]): number {
  return roundCents(values.reduce((s, v) => s + v, 0));
}

/**
 * Assets page body.
 * @param props - Component props.
 * @param props.assets - Every asset with its schedule.
 * @param props.expenseOptions - Every expense the form can link to.
 * @param props.currentFyKey - Current FY key.
 * @param props.lowValueThreshold - Low-value write-off threshold.
 * @param props.gst - GST registration status, for the form's cost label and hint.
 * @param props.prefill - Values from ?fromExpense, or null.
 * @param props.initialEditId - Asset linked to the ?fromExpense expense, or null.
 * @param props.fromExpenseMissing - Whether ?fromExpense named a missing expense.
 * @param props.filedYears - Filed years the edit forms warn about.
 * @returns The view.
 */
export function AssetsView({
  assets,
  expenseOptions,
  currentFyKey,
  lowValueThreshold,
  gst,
  prefill,
  initialEditId,
  fromExpenseMissing,
  filedYears,
}: AssetsViewProps): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [formTarget, setFormTarget] = useState<AssetFormTarget | null>(() =>
    initialTarget(assets, prefill, initialEditId),
  );
  const [scheduleAsset, setScheduleAsset] = useState<AssetView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssetView | null>(null);
  const [deleting, setDeleting] = useState(false);

  const ordered = useMemo(() => [...assets].sort(registerOrder), [assets]);
  const filedFyKeys = useMemo(() => new Set(filedYears.map((fy) => fy.fyKey)), [filedYears]);
  const inUse = assets.filter((a) => a.disposedAt === null);
  const valueNow = sumCents(inUse.map((a) => a.current?.closingAtv ?? 0));
  const claimThisFy = sumCents(assets.map((a) => a.current?.deductible ?? 0));

  /** Closes the form and drops ?fromExpense so a reload doesn't reopen it. */
  function closeForm(): void {
    setFormTarget(null);
    if (searchParams.has("fromExpense"))
      router.replace("/admin/business/assets", { scroll: false });
  }

  /**
   * Confirms a save and reloads the server-computed schedules.
   * @param message - Confirmation text.
   */
  function handleSaved(message: string): void {
    closeForm();
    toast(message, { tone: "success" });
    router.refresh();
  }

  /** Deletes the asset in the confirm dialog. */
  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/business/assets/${deleteTarget.id}`, { method: "DELETE" });
      const d = (await res.json()) as { ok: boolean; error?: string };
      if (d.ok) {
        setDeleteTarget(null);
        toast("Asset deleted.", { tone: "success" });
        router.refresh();
      } else {
        toast(d.error ?? "Couldn't delete the asset.", { tone: "error" });
      }
    } catch {
      toast("Couldn't delete the asset. Check your connection.", { tone: "error" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      {fromExpenseMissing && searchParams.has("fromExpense") && (
        <Notice tone="warn" role="alert" className="mb-5">
          That expense wasn&apos;t found, so there was nothing to fill in. Add the asset by hand, or
          go back to Expenses and try again.
        </Notice>
      )}

      <StatStrip label="Register totals" className="mb-5 grid-cols-2 lg:grid-cols-4">
        <StatCard label="In use" value={inUse.length} />
        <StatCard label="Tax value now" value={formatNZD(valueNow)} sub="Items still in use" />
        <StatCard
          label={`Depreciation FY ${currentFyKey}`}
          value={formatNZD(claimThisFy)}
          sub="Business share you claim"
          tone="success"
        />
        <StatCard label="Disposed" value={assets.length - inUse.length} />
      </StatStrip>

      <Notice className="mb-5">
        Bought items costing {formatDollars(lowValueThreshold)} or less are written off in full in
        the year you start using them. Items from the same supplier on the same day count together.
        Brought-in items are depreciated instead.
      </Notice>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-admin-text">Register</h2>
        {/* An empty register has its own Add asset in the empty state. */}
        {assets.length > 0 && (
          <AdminButton
            onClick={() => setFormTarget({ mode: "new", prefill: null })}
            className="max-sm:w-full"
          >
            <FaPlus aria-hidden />
            Add asset
          </AdminButton>
        )}
      </div>

      <AssetList
        assets={ordered}
        currentFyKey={currentFyKey}
        onAdd={() => setFormTarget({ mode: "new", prefill: null })}
        onSchedule={setScheduleAsset}
        onEdit={(a) => setFormTarget({ mode: "edit", asset: a })}
        onDelete={setDeleteTarget}
      />

      {formTarget && (
        <AssetFormModal
          key={formTarget.mode === "edit" ? formTarget.asset.id : "new"}
          target={formTarget}
          expenseOptions={expenseOptions}
          lowValueThreshold={lowValueThreshold}
          gst={gst}
          onClose={closeForm}
          onSaved={handleSaved}
          filedYears={filedYears}
        />
      )}

      <AssetScheduleModal
        asset={scheduleAsset}
        onClose={() => setScheduleAsset(null)}
        filedFyKeys={filedFyKeys}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete ${deleteTarget?.name ?? "this asset"}?`}
        body={
          <>
            {deleteTarget?.expenseId
              ? "This removes it from the register and the tax figures. Its linked expense counts as an ordinary expense again."
              : "This removes it from the register and the tax figures."}
            {deleteTarget && (
              <FiledYearWarning
                filedYears={filedYears}
                spans={[{ from: deleteTarget.inServiceDate, to: deleteTarget.disposedAt }]}
                className="mt-3"
              />
            )}
          </>
        }
        confirmLabel="Delete"
        tone="danger"
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
