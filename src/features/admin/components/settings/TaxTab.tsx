"use client";
// src/features/admin/components/settings/TaxTab.tsx
// Editor for the tax group: the ACC and KiwiSaver rates (stored as fractions), the
// income-tax bands, the IETC, the thresholds, the vehicle fuel type and the per-category
// business-use shares. The Tax, Assets and Trips pages and the overview's tax card read
// these live; nothing overrides them.

import {
  FieldShell,
  NumberField,
  SettingsTabBody,
  ToggleField,
} from "@/features/admin/components/settings/SettingsFields";
import { SettingsFooter } from "@/features/admin/components/settings/SettingsFooter";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { TaxBracketsField } from "@/features/admin/components/settings/TaxBracketsField";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { ADMIN_EYEBROW_CLS } from "@/features/admin/components/ui/field-classes";
import { EXPENSE_CATEGORIES } from "@/features/business/lib/constants";
import type { IetcConfig, VehicleFuel } from "@/features/business/lib/tax/types";
import { cn } from "@/shared/lib/cn";
import { TAX_FIELD_META, VEHICLE_FUEL_LABELS } from "@/shared/lib/settings/field-meta";
import type { TaxSettings } from "@/shared/lib/settings/types";
import type React from "react";

interface Props {
  initial: TaxSettings;
  defaults: TaxSettings;
}

/** Business share a category counts at when the settings leave it out. */
const FULL_BUSINESS_USE = 100;

/**
 * Tax settings tab.
 * @param props - Component props.
 * @param props.initial - Server-resolved current tax settings.
 * @param props.defaults - Code default tax settings.
 * @returns Tax tab element.
 */
export function TaxTab({ initial, defaults }: Props): React.ReactElement {
  const form = useSettingsForm("tax", initial, defaults);
  const { draft, setDraft, fieldErrors } = form;
  const m = TAX_FIELD_META;

  /**
   * Merges a tax patch into the draft.
   * @param patch - Partial tax fields.
   * @returns void
   */
  const set = (patch: Partial<TaxSettings>): void => setDraft((p) => ({ ...p, ...patch }));

  /**
   * Merges an IETC patch into the draft.
   * @param patch - Partial IETC fields.
   */
  const setIetc = (patch: Partial<IetcConfig>): void => {
    setDraft((p) => ({ ...p, ietc: { ...p.ietc, ...patch } }));
  };

  /**
   * Sets one category's business-use percent. 100 removes the entry, because a missing
   * category already counts in full, so the stored object holds only the exceptions.
   * @param category - Expense category.
   * @param pct - Business share, 0-100.
   */
  const setCategoryUse = (category: string, pct: number): void => {
    setDraft((p) => {
      const next = { ...p.categoryBusinessUse };
      if (pct === FULL_BUSINESS_USE) delete next[category];
      else next[category] = pct;
      return { ...p, categoryBusinessUse: next };
    });
  };

  const categoryError = Object.entries(fieldErrors).find(([k]) =>
    k.startsWith("categoryBusinessUse"),
  )?.[1];

  return (
    <SettingsTabBody changed={form.changedPaths}>
      <p className="mb-4 text-sm text-admin-muted">Enter each rate as a percentage.</p>
      <div className="divide-y divide-admin-border">
        <NumberField
          id="acc"
          meta={m.acc}
          // Stored as a fraction; shown + edited as a percent (2dp, so ACC's 1.75% survives).
          value={Math.round(draft.acc * 10000) / 100}
          min={0}
          max={100}
          error={fieldErrors.acc}
          customised={draft.acc !== defaults.acc}
          onChange={(v) => set({ acc: (v ?? 0) / 100 })}
        />
        <NumberField
          id="kiwiSaver"
          meta={m.kiwiSaver}
          value={Math.round(draft.kiwiSaver * 10000) / 100}
          min={0}
          max={100}
          error={fieldErrors.kiwiSaver}
          customised={draft.kiwiSaver !== defaults.kiwiSaver}
          onChange={(v) => set({ kiwiSaver: (v ?? 0) / 100 })}
        />
      </div>

      <h3 className={cn("mt-6", ADMIN_EYEBROW_CLS)}>Income tax</h3>
      <div className="divide-y divide-admin-border">
        <TaxBracketsField
          brackets={draft.brackets}
          fieldErrors={fieldErrors}
          customised={JSON.stringify(draft.brackets) !== JSON.stringify(defaults.brackets)}
          onChange={(brackets) => set({ brackets })}
        />
        <ToggleField
          id="ietc.enabled"
          meta={m["ietc.enabled"]}
          value={draft.ietc.enabled}
          customised={draft.ietc.enabled !== defaults.ietc.enabled}
          onChange={(enabled) => setIetc({ enabled })}
        />
        <NumberField
          id="ietc.annual"
          meta={m["ietc.annual"]}
          value={draft.ietc.annual}
          min={0}
          error={fieldErrors["ietc.annual"]}
          customised={draft.ietc.annual !== defaults.ietc.annual}
          onChange={(v) => setIetc({ annual: v ?? 0 })}
        />
        <NumberField
          id="ietc.from"
          meta={m["ietc.from"]}
          value={draft.ietc.from}
          min={0}
          error={fieldErrors["ietc.from"]}
          customised={draft.ietc.from !== defaults.ietc.from}
          onChange={(v) => setIetc({ from: v ?? 0 })}
        />
        <NumberField
          id="ietc.fullTo"
          meta={m["ietc.fullTo"]}
          value={draft.ietc.fullTo}
          min={0}
          error={fieldErrors["ietc.fullTo"]}
          customised={draft.ietc.fullTo !== defaults.ietc.fullTo}
          onChange={(v) => setIetc({ fullTo: v ?? 0 })}
        />
        <NumberField
          id="ietc.cutoff"
          meta={m["ietc.cutoff"]}
          value={draft.ietc.cutoff}
          min={0}
          error={fieldErrors["ietc.cutoff"]}
          customised={draft.ietc.cutoff !== defaults.ietc.cutoff}
          onChange={(v) => setIetc({ cutoff: v ?? 0 })}
        />
        <NumberField
          id="ietc.abatementPerDollar"
          meta={m["ietc.abatementPerDollar"]}
          // Stored per dollar (0.13); shown + edited in cents (13).
          value={Math.round(draft.ietc.abatementPerDollar * 10000) / 100}
          min={0}
          max={100}
          error={fieldErrors["ietc.abatementPerDollar"]}
          customised={draft.ietc.abatementPerDollar !== defaults.ietc.abatementPerDollar}
          onChange={(v) => setIetc({ abatementPerDollar: (v ?? 0) / 100 })}
        />
        <NumberField
          id="provisionalThreshold"
          meta={m.provisionalThreshold}
          value={draft.provisionalThreshold}
          min={0}
          error={fieldErrors.provisionalThreshold}
          customised={draft.provisionalThreshold !== defaults.provisionalThreshold}
          onChange={(v) => set({ provisionalThreshold: v ?? 0 })}
        />
      </div>

      <h3 className={cn("mt-6", ADMIN_EYEBROW_CLS)}>Assets and vehicle</h3>
      <div className="divide-y divide-admin-border">
        <NumberField
          id="lowValueThreshold"
          meta={m.lowValueThreshold}
          value={draft.lowValueThreshold}
          min={0}
          error={fieldErrors.lowValueThreshold}
          customised={draft.lowValueThreshold !== defaults.lowValueThreshold}
          onChange={(v) => set({ lowValueThreshold: v ?? 0 })}
        />
        <FieldShell
          id="vehicleFuel"
          meta={m.vehicleFuel}
          error={fieldErrors.vehicleFuel}
          customised={draft.vehicleFuel !== defaults.vehicleFuel}
        >
          <AdminSelect
            id="vehicleFuel"
            value={draft.vehicleFuel}
            onChange={(e) => set({ vehicleFuel: e.target.value as VehicleFuel })}
            className="sm:w-56"
          >
            {(Object.keys(VEHICLE_FUEL_LABELS) as VehicleFuel[]).map((fuel) => (
              <option key={fuel} value={fuel}>
                {VEHICLE_FUEL_LABELS[fuel]}
              </option>
            ))}
          </AdminSelect>
        </FieldShell>
      </div>

      <h3 className={cn("mt-6", ADMIN_EYEBROW_CLS)}>Business use</h3>
      <div className="divide-y divide-admin-border">
        <FieldShell
          id="categoryBusinessUse"
          meta={m.categoryBusinessUse}
          error={categoryError}
          customised={Object.keys(draft.categoryBusinessUse).length > 0}
        >
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {EXPENSE_CATEGORIES.map((category, i) => {
              const err = fieldErrors[`categoryBusinessUse.${category}`];
              return (
                <label
                  key={category}
                  className="flex items-center justify-between gap-3 text-sm text-admin-text"
                >
                  <span>{category}</span>
                  <span className="flex items-center gap-1">
                    <AdminInput
                      id={i === 0 ? "categoryBusinessUse" : undefined}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step="any"
                      value={draft.categoryBusinessUse[category] ?? FULL_BUSINESS_USE}
                      onChange={(e) => {
                        const n = e.target.value === "" ? 0 : Number(e.target.value);
                        if (Number.isFinite(n)) setCategoryUse(category, n);
                      }}
                      aria-invalid={err ? true : undefined}
                      className={cn("w-24", err && "border-coquelicot-600")}
                    />
                    <span className="text-admin-muted">%</span>
                  </span>
                </label>
              );
            })}
          </div>
        </FieldShell>
      </div>

      <SettingsFooter form={form} />

      {/* A stored version from before a field existed lacks it; fill the gaps from defaults. */}
      <SettingsHistory
        group="tax"
        onRestore={(v: TaxSettings) => setDraft({ ...defaults, ...v })}
      />
    </SettingsTabBody>
  );
}
