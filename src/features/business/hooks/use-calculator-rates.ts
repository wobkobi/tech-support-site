"use client";
// src/features/business/hooks/use-calculator-rates.ts
// Rate table state for the job calculator's "Manage rates" panel: the live list, the
// add/edit form, and the create/edit/delete/reset calls against the rates API.

import type { RateConfig } from "@/features/business/types/business";
import type React from "react";
import { useState } from "react";

/**
 * Blank state for the rate panel's add/edit form. Shared by the mount default,
 * the cancel-edit path, and the full clear so they cannot drift apart.
 */
const BLANK_RATE_FORM = {
  label: "",
  type: "hourly" as "flat" | "hourly" | "modifier" | "percent",
  amount: "",
  unit: "hour",
  isDefault: false,
};

/** Shape of the rate panel's add/edit form. */
export type RateForm = typeof BLANK_RATE_FORM;

/** State and handlers returned by {@link useCalculatorRates}. */
export interface UseCalculatorRates {
  /** Live rate list; the calculator prices every task from it. */
  rates: RateConfig[];
  /** Current add/edit form values. */
  rateForm: RateForm;
  /** Form setter handed to the rate panel. */
  setRateForm: React.Dispatch<React.SetStateAction<RateForm>>;
  /** Id of the rate being edited, or null when the form adds a new one. */
  editingRateId: string | null;
  /** True while a reset-to-defaults request is in flight. */
  resettingRates: boolean;
  /** Loads a rate into the form and enters edit mode. */
  handleStartEdit: (r: RateConfig) => void;
  /** Leaves edit mode and blanks the form. */
  handleCancelEdit: () => void;
  /** Wipes every rate and reseeds the defaults. */
  handleResetRates: () => Promise<void>;
  /** Saves the form: PATCH when editing, POST otherwise. */
  handleSubmitRate: (e: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
  /** Deletes a rate by id. */
  handleDeleteRate: (id: string) => Promise<void>;
}

/**
 * Owns the calculator's rate list and the rate panel's form, seeded from the
 * server-resolved rates so the calculator renders without a fetch waterfall.
 * @param initialRates - Rate configs resolved server-side.
 * @returns Rate state plus the panel's handlers.
 */
export function useCalculatorRates(initialRates: RateConfig[]): UseCalculatorRates {
  // Server-resolved reference data; setters keep the rate panel's refresh path working.
  const [rates, setRates] = useState<RateConfig[]>(initialRates);
  const [rateForm, setRateForm] = useState(BLANK_RATE_FORM);
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [resettingRates, setResettingRates] = useState(false);

  /**
   * Populates the rate form with an existing rate's values and enters edit mode.
   * @param r - The rate configuration to edit.
   */
  function handleStartEdit(r: RateConfig): void {
    const type: "hourly" | "modifier" | "flat" | "percent" =
      r.ratePerHour !== null
        ? "hourly"
        : r.percentDelta !== null
          ? "percent"
          : r.hourlyDelta !== null
            ? "modifier"
            : "flat";
    const modifierAmount = r.percentDelta !== null ? r.percentDelta * 100 : r.hourlyDelta;
    setEditingRateId(r.id);
    setRateForm({
      label: r.label,
      type,
      amount: String(r.ratePerHour ?? modifierAmount ?? r.flatRate ?? ""),
      unit: r.unit,
      isDefault: r.isDefault,
    });
  }

  /**
   * Cancels an in-progress rate edit and resets the form to its blank state.
   */
  function handleCancelEdit(): void {
    setEditingRateId(null);
    setRateForm(BLANK_RATE_FORM);
  }

  /**
   * Re-fetches the rates list from the API. Used after a reset and after
   * a 404 on edit/delete (which means the row was wiped server-side and the
   * local snapshot is stale).
   */
  async function refreshRates(): Promise<void> {
    try {
      const res = await fetch("/api/business/rates");
      if (!res.ok) return;
      const d = await res.json();
      if (d.ok && Array.isArray(d.rates)) setRates(d.rates);
    } catch (err) {
      console.error("[calculator] refreshRates failed:", err);
    }
  }

  /**
   * Wipes every rate row and reseeds the defaults (Standard base + modifier
   * set). Confirms first since this drops any custom rates. Also cancels any
   * in-progress edit so the form doesn't hold a stale ID.
   */
  async function handleResetRates(): Promise<void> {
    handleCancelEdit();
    setResettingRates(true);
    try {
      const res = await fetch("/api/business/rates", { method: "DELETE" });
      if (!res.ok) {
        console.error("[calculator] reset rates failed with status", res.status);
        return;
      }
      const d = await res.json();
      if (d.ok && Array.isArray(d.rates)) setRates(d.rates);
    } finally {
      setResettingRates(false);
    }
  }

  /**
   * Submits the rate form - PATCHes the existing rate when editing, or POSTs a new one.
   * @param e - The form submit event.
   */
  async function handleSubmitRate(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const amount = parseFloat(rateForm.amount);
    const body = {
      label: rateForm.label,
      ratePerHour: rateForm.type === "hourly" ? amount : null,
      flatRate: rateForm.type === "flat" ? amount : null,
      hourlyDelta: rateForm.type === "modifier" ? amount : null,
      // Percent modifiers store a fraction (25 entered > 0.25).
      percentDelta: rateForm.type === "percent" ? amount / 100 : null,
      unit:
        rateForm.type === "modifier" || rateForm.type === "percent" ? "modifier" : rateForm.unit,
      isDefault: rateForm.type === "hourly" ? rateForm.isDefault : false,
    };

    if (editingRateId) {
      const res = await fetch(`/api/business/rates/${editingRateId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      // Bail safely on non-OK - 404 typically means the rate was wiped via
      // Reset and the local snapshot is stale. Re-fetch and exit edit mode.
      if (!res.ok) {
        console.error("[calculator] PATCH rate failed with status", res.status);
        handleCancelEdit();
        await refreshRates();
        return;
      }
      const d = await res.json();
      if (d.ok) {
        setRates((prev) =>
          rateForm.isDefault
            ? prev.map((r) => (r.id === editingRateId ? d.rate : { ...r, isDefault: false }))
            : prev.map((r) => (r.id === editingRateId ? d.rate : r)),
        );
        handleCancelEdit();
      }
    } else {
      const res = await fetch("/api/business/rates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.error("[calculator] POST rate failed with status", res.status);
        return;
      }
      const d = await res.json();
      if (d.ok) {
        setRates((prev) =>
          rateForm.isDefault
            ? prev.map((r) => ({ ...r, isDefault: false })).concat(d.rate)
            : [...prev, d.rate],
        );
        setRateForm({ label: "", type: "hourly", amount: "", unit: "hour", isDefault: false });
      }
    }
  }

  /**
   * Prompts the user to confirm deletion, then sends a DELETE request for the given rate and
   * removes it from the local rates list on success.
   * @param id - The ID of the rate configuration to delete.
   */
  async function handleDeleteRate(id: string): Promise<void> {
    const res = await fetch(`/api/business/rates/${id}`, { method: "DELETE" });
    if (!res.ok) {
      // 404 = already deleted server-side. Refresh so the row disappears
      // from the table and the user can move on.
      console.error("[calculator] DELETE rate failed with status", res.status);
      await refreshRates();
      return;
    }
    const d = await res.json();
    if (d.ok) setRates((prev) => prev.filter((r) => r.id !== id));
  }

  return {
    rates,
    rateForm,
    setRateForm,
    editingRateId,
    resettingRates,
    handleStartEdit,
    handleCancelEdit,
    handleResetRates,
    handleSubmitRate,
    handleDeleteRate,
  };
}
