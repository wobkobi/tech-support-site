"use client";
// src/features/business/components/calculator/JobSettingsStrip.tsx
// Top strip of the calculator: job date, promo code entry, the form tools (clear, manage
// rates), the holiday chip, and the resolved promo with its per-job skip toggle.

import { summariseForBanner, type ActivePromo } from "@/features/business/lib/promos";
import type React from "react";

interface Props {
  jobDate: string;
  onJobDateChange: (date: string) => void;
  promoCodeInput: string;
  onPromoCodeInputChange: (value: string) => void;
  promoCode: string;
  onApplyPromoCode: () => void;
  onClearForm: () => void;
  showRates: boolean;
  onToggleRates: () => void;
  holiday: { name: string | null; uplift: number };
  activePromo: ActivePromo | null;
  skipPromo: boolean;
  onSkipPromoChange: (skip: boolean) => void;
}

/**
 * Job settings strip: the date, the promo code and the form tools share one
 * box, so the first screen reaches the event picker and the job description.
 * The date drives the public-holiday and promo lookup.
 * @param props - Component props.
 * @param props.jobDate - Selected job date (YYYY-MM-DD).
 * @param props.onJobDateChange - Called with the picked date, or "" when the input is cleared.
 * @param props.promoCodeInput - The promo code box's current text.
 * @param props.onPromoCodeInputChange - Called with the uppercased box text.
 * @param props.promoCode - The applied promo code, or "".
 * @param props.onApplyPromoCode - Applies the box text as the promo code.
 * @param props.onClearForm - Opens the clear-form confirm.
 * @param props.showRates - Whether the rate panel is open.
 * @param props.onToggleRates - Opens or closes the rate panel.
 * @param props.holiday - Holiday name + labour uplift for the job date.
 * @param props.activePromo - Promo resolved for the job date, or null.
 * @param props.skipPromo - Whether the promo is skipped for this job.
 * @param props.onSkipPromoChange - Toggles the per-job promo skip.
 * @returns Job settings strip element.
 */
export function JobSettingsStrip({
  jobDate,
  onJobDateChange,
  promoCodeInput,
  onPromoCodeInputChange,
  promoCode,
  onApplyPromoCode,
  onClearForm,
  showRates,
  onToggleRates,
  holiday,
  activePromo,
  skipPromo,
  onSkipPromoChange,
}: Props): React.ReactElement {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-2">
          {/* Matching label widths line the two boxes up when they stack on a phone. */}
          <label
            htmlFor="job-date"
            className="shrink-0 text-sm font-semibold text-slate-700 max-sm:w-22"
          >
            Job date
          </label>
          <input
            id="job-date"
            type="date"
            value={jobDate}
            onChange={(e) => onJobDateChange(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
          />
        </div>

        {/* Code entry for a job taken over the phone. It renders whether or
            not a promo resolved - without it there would be nowhere to type a
            code when no automatic promo is running, which is exactly when a
            code matters. */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="calc-promo-code"
            className="shrink-0 text-sm font-semibold text-slate-700 max-sm:w-22"
          >
            Promo code
          </label>
          <input
            id="calc-promo-code"
            value={promoCodeInput}
            onChange={(e) => onPromoCodeInputChange(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onApplyPromoCode();
              }
            }}
            placeholder="None"
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            className="w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tracking-wider uppercase focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
          />
          <button
            type="button"
            onClick={onApplyPromoCode}
            disabled={promoCodeInput.trim() === promoCode}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Apply
          </button>
        </div>

        {/* The full clear lives up here rather than under the save buttons: it
            is the "start over" action, reached mid-form far more often than at
            the end, and destructive styling keeps it from reading as a fifth
            way to save. */}
        <div className="ml-auto flex gap-2">
          <button
            onClick={onClearForm}
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Clear form
          </button>
          <button
            onClick={onToggleRates}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {showRates ? "Hide rates" : "Manage rates"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>The job date sets which promo and public-holiday rate apply.</span>
        {holiday.name && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-800">
            {holiday.name} - labour +{Math.round(holiday.uplift * 100)}%
          </span>
        )}
      </div>

      {/* The verdict comes from the job-date lookup, not a live check: a
          code can be valid today and not on the day the job was done. */}
      {promoCode !== "" && activePromo?.code !== promoCode && (
        <p className="text-sm font-medium text-red-700">
          {promoCode} isn&apos;t valid on {jobDate} - pricing uses whatever promo applied that day.
        </p>
      )}

      {/* The promo that applies, with a per-job skip toggle. */}
      {activePromo && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <span aria-hidden="true">⚡</span>
            <span className="font-semibold">Promo: {activePromo.title}</span>
            <span className="text-xs text-amber-700">({summariseForBanner(activePromo)})</span>
            {activePromo.code && (
              <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-semibold tracking-wider">
                {activePromo.code}
              </span>
            )}
            {skipPromo && <span className="text-xs italic">- skipped for this job</span>}
          </div>
          <label className="flex items-center gap-2 text-xs text-amber-800">
            <input
              type="checkbox"
              checked={skipPromo}
              onChange={(e) => onSkipPromoChange(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Skip promo for this job
          </label>
        </div>
      )}
    </div>
  );
}
