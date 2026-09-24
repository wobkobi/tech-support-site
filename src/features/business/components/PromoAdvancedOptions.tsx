"use client";
// Folded "Advanced options" section of the promo form: priority, spend
// thresholds, usage limits and the weekday/time restriction.

import {
  advancedChips,
  AMOUNT_LABEL,
  PROMO_INPUT_CLASS,
  WEEKDAY_LABELS,
  type FormState,
} from "@/features/business/lib/promo-form";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Props for {@link PromoAdvancedOptions}. */
interface PromoAdvancedOptionsProps {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  /** Whether the section is unfolded. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Rarely-touched promo settings, folded away. The summary names every one that
 * is set, so a live restriction is never hidden behind the fold.
 * @param props - Component props.
 * @param props.form - Current form state.
 * @param props.setForm - Form state setter.
 * @param props.open - Whether the section is unfolded.
 * @param props.onOpenChange - Receives the new open state when toggled.
 * @returns The advanced options section.
 */
export function PromoAdvancedOptions({
  form,
  setForm,
  open,
  onOpenChange,
}: PromoAdvancedOptionsProps): React.ReactElement {
  const chips = advancedChips(form);
  return (
    <details
      open={open}
      onToggle={(e) => onOpenChange(e.currentTarget.open)}
      className="rounded-xl border border-admin-border"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm font-semibold text-admin-text">
        Advanced options
        {chips.map((chip) => (
          <span
            key={chip}
            className="rounded bg-admin-bg px-1.5 py-0.5 text-xs font-semibold text-admin-muted"
          >
            {chip}
          </span>
        ))}
        {chips.length === 0 && (
          <span className="text-xs font-normal text-admin-faint">
            Priority, spend thresholds, usage limits, days and times
          </span>
        )}
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-admin-muted">Priority</span>
          <input
            type="number"
            step={1}
            value={form.priority}
            onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
            className={cn(PROMO_INPUT_CLASS, "w-32")}
          />
          <span className="text-xs text-admin-faint">
            Higher wins when two promos overlap. Ties go to the newer one.
          </span>
        </label>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-admin-border p-4">
          <legend className="px-1 text-xs font-medium text-admin-muted">
            Spend thresholds (optional)
          </legend>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-admin-muted">Minimum spend ($)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.minSpend}
              onChange={(e) => setForm((p) => ({ ...p, minSpend: e.target.value }))}
              placeholder="No minimum"
              className={cn(PROMO_INPUT_CLASS, "w-40")}
            />
          </label>

          {form.tiers.length > 0 && (
            <div className="flex flex-col gap-2">
              {form.tiers.map((tier, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-admin-muted">Spend over ($)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={tier.minSpend}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          tiers: p.tiers.map((t, j) =>
                            j === i ? { ...t, minSpend: e.target.value } : t,
                          ),
                        }))
                      }
                      className={cn(PROMO_INPUT_CLASS, "w-32")}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-admin-muted">
                      {AMOUNT_LABEL[form.type]}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={tier.amount}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          tiers: p.tiers.map((t, j) =>
                            j === i ? { ...t, amount: e.target.value } : t,
                          ),
                        }))
                      }
                      className={cn(PROMO_INPUT_CLASS, "w-32")}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((p) => ({ ...p, tiers: p.tiers.filter((_, j) => j !== i) }))
                    }
                    className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() =>
              setForm((p) => ({ ...p, tiers: [...p.tiers, { minSpend: "", amount: "" }] }))
            }
            className="self-start rounded-lg border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-medium text-admin-muted hover:bg-admin-bg"
          >
            Add a spend tier
          </button>
          <p className="text-sm text-admin-faint">
            With no tiers the promo gives its single amount above. With tiers, the highest one the
            job reaches supplies the discount and the amount above is ignored - a job that reaches
            none gets nothing rather than a smaller discount. Thresholds are read against the low
            end of the quote before any discount, so the customer is quoted what they are certain to
            get and a job that lands higher earns more on the invoice.
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-admin-border p-4">
          <legend className="px-1 text-xs font-medium text-admin-muted">Who can use it</legend>
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-admin-muted">Total uses</span>
              <input
                type="number"
                min="1"
                step={1}
                value={form.maxRedemptions}
                onChange={(e) => setForm((p) => ({ ...p, maxRedemptions: e.target.value }))}
                placeholder="No limit"
                className={cn(PROMO_INPUT_CLASS, "w-32")}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-admin-muted">Uses per customer</span>
              <input
                type="number"
                min="1"
                step={1}
                value={form.perCustomerLimit}
                onChange={(e) => setForm((p) => ({ ...p, perCustomerLimit: e.target.value }))}
                placeholder="No limit"
                className={cn(PROMO_INPUT_CLASS, "w-32")}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-admin-muted">
            <input
              type="checkbox"
              checked={form.newCustomersOnly}
              onChange={(e) => setForm((p) => ({ ...p, newCustomersOnly: e.target.checked }))}
              className="h-4 w-4"
            />
            New customers only (nobody with a completed job on file)
          </label>
          <p className="text-sm text-admin-faint">
            The total cap is approximate: two people can pass it at the same moment and both redeem.
            Per-customer and new-customer rules need someone the site can identify, so an
            unrecognised email is allowed through rather than refused.
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-admin-border p-4">
          <legend className="px-1 text-xs font-medium text-admin-muted">
            When it applies (optional)
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABELS.map((label, day) => {
              const picked = form.activeWeekdays.includes(day);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={picked}
                  onClick={() =>
                    setForm((p) => ({
                      ...p,
                      activeWeekdays: picked
                        ? p.activeWeekdays.filter((d) => d !== day)
                        : [...p.activeWeekdays, day].sort((a, b) => a - b),
                    }))
                  }
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm font-medium",
                    picked
                      ? "border-admin-text bg-admin-text text-admin-surface"
                      : "border-admin-border bg-admin-surface text-admin-muted hover:bg-admin-bg",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-admin-muted">From</span>
              <input
                type="time"
                value={form.activeFrom}
                onChange={(e) => setForm((p) => ({ ...p, activeFrom: e.target.value }))}
                className={cn(PROMO_INPUT_CLASS, "w-32")}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-admin-muted">To</span>
              <input
                type="time"
                value={form.activeTo}
                onChange={(e) => setForm((p) => ({ ...p, activeTo: e.target.value }))}
                className={cn(PROMO_INPUT_CLASS, "w-32")}
              />
            </label>
            {(form.activeFrom || form.activeTo) && (
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, activeFrom: "", activeTo: "" }))}
                className="pb-2 text-xs font-medium text-admin-muted underline hover:text-admin-text"
              >
                Clear times
              </button>
            )}
          </div>
          <p className="text-sm text-admin-faint">
            Leave blank to run the whole window. These are matched against the appointment in NZ
            time, not against when the customer is browsing, so a Tuesday offer is earned by booking
            a Tuesday job on any day. The banner still advertises the promo throughout and names the
            restriction.
          </p>
        </fieldset>
      </div>
    </details>
  );
}
