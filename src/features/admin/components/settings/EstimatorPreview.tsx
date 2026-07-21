"use client";
// src/features/admin/components/settings/EstimatorPreview.tsx
/**
 * @description Live worked example for the estimator settings: a sample job run
 * through the shared {@link priceRangeFor} at each confidence level, so the
 * range factors + low-end floor read as real dollars while the operator edits.
 * Mirrors the Availability/Pricing preview affordances.
 */

import { priceRangeFor } from "@/features/business/lib/estimate-range";
import type { EstimateConfidence, EstimatorSettings } from "@/shared/lib/settings/types";
import type React from "react";

/** Sample inputs for the worked example; illustrative only, not a live quote. */
const SAMPLE_MINS = 120;
const SAMPLE_RATE = 65;

const CONFIDENCE: { key: EstimateConfidence; label: string }[] = [
  { key: "high", label: "Clear description" },
  { key: "medium", label: "Some detail" },
  { key: "low", label: "Vague" },
];

/**
 * Worked-example price bands for the current estimator settings.
 * @param props - Component props.
 * @param props.estimator - The draft estimator settings being edited.
 * @returns Preview element.
 */
export function EstimatorPreview({
  estimator,
}: {
  estimator: EstimatorSettings;
}): React.ReactElement {
  return (
    <div className="mt-8 rounded-lg border border-admin-border p-4">
      <p className="text-xs font-bold tracking-wide text-russian-violet uppercase">
        Worked example
      </p>
      <p className="mt-1 text-sm text-admin-muted">
        A {SAMPLE_MINS / 60}-hour job at ${SAMPLE_RATE}/hr, priced at each confidence level with the
        settings above. Illustrative only.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {CONFIDENCE.map(({ key, label }) => {
          const { low, high } = priceRangeFor(
            SAMPLE_MINS,
            SAMPLE_RATE,
            key,
            estimator.range,
            estimator.lowEndFloorFactor,
          );
          return (
            <div
              key={key}
              className="rounded-lg border border-admin-border bg-admin-surface p-3 text-center"
            >
              <p className="text-xs text-admin-muted">{label}</p>
              <p className="mt-1 text-base font-bold text-russian-violet">
                ${low} - ${high}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
