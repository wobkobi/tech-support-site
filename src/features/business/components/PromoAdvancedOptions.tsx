"use client";
// src/features/business/components/PromoAdvancedOptions.tsx
// Folded "Advanced options" section of the promo form: priority, spend
// thresholds, usage limits and the weekday/time restriction.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import {
  chipClass,
  TEXT_ACTION_CLS,
} from "@/features/business/components/calculator/calculator-classes";
import {
  advancedChips,
  AMOUNT_LABEL,
  WEEKDAY_LABELS,
  type FormState,
} from "@/features/business/lib/promo-form";
import type React from "react";
import { useId } from "react";

/** Legend for a group of advanced fields. */
const LEGEND_CLS = "px-1 text-sm font-bold text-admin-text";

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
  const id = useId();
  const chips = advancedChips(form);
  return (
    <details
      open={open}
      onToggle={(e) => onOpenChange(e.currentTarget.open)}
      className="rounded-lg border border-admin-border"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-[0.9375rem] font-bold text-admin-text">
        Advanced options
        {chips.map((chip) => (
          <span
            key={chip}
            className="rounded bg-admin-bg px-1.5 py-0.5 text-sm font-semibold text-admin-muted"
          >
            {chip}
          </span>
        ))}
        {chips.length === 0 && (
          <span className="text-sm font-normal text-admin-muted">
            Priority, spend thresholds, usage limits, days and times
          </span>
        )}
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <AdminField
          label="Priority"
          htmlFor={`${id}-priority`}
          hint="Higher wins when two promos overlap. Ties go to the newer one."
        >
          <AdminInput
            id={`${id}-priority`}
            type="number"
            step={1}
            value={form.priority}
            onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
            className="w-32"
          />
        </AdminField>

        <fieldset className="flex flex-col gap-3 rounded-lg border border-admin-border p-4">
          <legend className={LEGEND_CLS}>Spend thresholds (optional)</legend>
          <AdminField label="Minimum spend ($)" htmlFor={`${id}-min-spend`}>
            <AdminInput
              id={`${id}-min-spend`}
              type="number"
              min="0"
              step="0.01"
              value={form.minSpend}
              onChange={(e) => setForm((p) => ({ ...p, minSpend: e.target.value }))}
              placeholder="No minimum"
              className="w-40"
            />
          </AdminField>

          {form.tiers.length > 0 && (
            <div className="flex flex-col gap-2">
              {form.tiers.map((tier, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <AdminField label="Spend over ($)" htmlFor={`${id}-tier-${i}-spend`}>
                    <AdminInput
                      id={`${id}-tier-${i}-spend`}
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
                      className="w-32"
                    />
                  </AdminField>
                  <AdminField label={AMOUNT_LABEL[form.type]} htmlFor={`${id}-tier-${i}-amount`}>
                    <AdminInput
                      id={`${id}-tier-${i}-amount`}
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
                      className="w-32"
                    />
                  </AdminField>
                  <AdminButton
                    type="button"
                    variant="danger"
                    onClick={() =>
                      setForm((p) => ({ ...p, tiers: p.tiers.filter((_, j) => j !== i) }))
                    }
                  >
                    Remove
                  </AdminButton>
                </div>
              ))}
            </div>
          )}

          <AdminButton
            type="button"
            variant="secondary"
            onClick={() =>
              setForm((p) => ({ ...p, tiers: [...p.tiers, { minSpend: "", amount: "" }] }))
            }
            className="self-start"
          >
            Add a spend tier
          </AdminButton>
          <p className="text-sm text-admin-muted">
            With no tiers the promo gives its single amount above. With tiers, the highest one the
            job reaches supplies the discount and the amount above is ignored - a job that reaches
            none gets nothing rather than a smaller discount. Thresholds are read against the low
            end of the quote before any discount, so the customer is quoted what they are certain to
            get and a job that lands higher earns more on the invoice.
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-lg border border-admin-border p-4">
          <legend className={LEGEND_CLS}>Who can use it</legend>
          <div className="flex flex-wrap gap-4">
            <AdminField label="Total uses" htmlFor={`${id}-max-redemptions`}>
              <AdminInput
                id={`${id}-max-redemptions`}
                type="number"
                min="1"
                step={1}
                value={form.maxRedemptions}
                onChange={(e) => setForm((p) => ({ ...p, maxRedemptions: e.target.value }))}
                placeholder="No limit"
                className="w-32"
              />
            </AdminField>
            <AdminField label="Uses per customer" htmlFor={`${id}-per-customer`}>
              <AdminInput
                id={`${id}-per-customer`}
                type="number"
                min="1"
                step={1}
                value={form.perCustomerLimit}
                onChange={(e) => setForm((p) => ({ ...p, perCustomerLimit: e.target.value }))}
                placeholder="No limit"
                className="w-32"
              />
            </AdminField>
          </div>
          <AdminCheckbox
            checked={form.newCustomersOnly}
            onChange={(checked) => setForm((p) => ({ ...p, newCustomersOnly: checked }))}
            label="New customers only (nobody with a completed job on file)"
          />
          <p className="text-sm text-admin-muted">
            The total cap is approximate: two people can pass it at the same moment and both redeem.
            Per-customer and new-customer rules need someone the site can identify, so an
            unrecognised email is allowed through rather than refused.
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-lg border border-admin-border p-4">
          <legend className={LEGEND_CLS}>When it applies (optional)</legend>
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
                  className={chipClass(picked)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <AdminField label="From" htmlFor={`${id}-from`}>
              <AdminInput
                id={`${id}-from`}
                type="time"
                value={form.activeFrom}
                onChange={(e) => setForm((p) => ({ ...p, activeFrom: e.target.value }))}
                className="w-32"
              />
            </AdminField>
            <AdminField label="To" htmlFor={`${id}-to`}>
              <AdminInput
                id={`${id}-to`}
                type="time"
                value={form.activeTo}
                onChange={(e) => setForm((p) => ({ ...p, activeTo: e.target.value }))}
                className="w-32"
              />
            </AdminField>
            {(form.activeFrom || form.activeTo) && (
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, activeFrom: "", activeTo: "" }))}
                className={`pb-2.5 ${TEXT_ACTION_CLS}`}
              >
                Clear times
              </button>
            )}
          </div>
          <p className="text-sm text-admin-muted">
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
