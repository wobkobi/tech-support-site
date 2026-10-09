"use client";
// src/features/admin/components/settings/TaxBracketsField.tsx
// Row editor for the income-tax bands on the tax settings tab. Each row is an upper limit
// and a rate (edited as a percent, stored as a fraction); the last row is the top band and
// has no limit. Row errors are keyed `brackets.<index>.upTo` / `brackets.<index>.rate` to
// match the validator.

import { FieldShell } from "@/features/admin/components/settings/SettingsFields";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import type { TaxBracket } from "@/features/business/lib/tax/types";
import { cn } from "@/shared/lib/cn";
import { TAX_FIELD_META } from "@/shared/lib/settings/field-meta";
import { MAX_TAX_BANDS } from "@/shared/lib/settings/validate";
import type React from "react";

interface Props {
  brackets: TaxBracket[];
  /** Field path > message, e.g. "brackets.2.upTo". */
  fieldErrors: Record<string, string>;
  /** True when the bands differ from the defaults. */
  customised: boolean;
  onChange: (next: TaxBracket[]) => void;
}

/** Gap between a new band's limit and the band below it. */
const NEW_BAND_STEP = 10000;

/**
 * Formats a band limit for the top band's label.
 * @param n - Limit in NZD.
 * @returns The limit as "$180,000".
 */
function dollars(n: number): string {
  return `$${n.toLocaleString("en-NZ")}`;
}

/**
 * Editable list of income-tax bands, lowest first.
 * @param props - Component props.
 * @param props.brackets - Current bands.
 * @param props.fieldErrors - Inline validation errors keyed by field path.
 * @param props.customised - Whether the bands differ from the defaults.
 * @param props.onChange - Called with the next band list on any edit.
 * @returns Bands editor element.
 */
export function TaxBracketsField({
  brackets,
  fieldErrors,
  customised,
  onChange,
}: Props): React.ReactElement {
  const last = brackets.length - 1;
  const topFloor = brackets[last - 1]?.upTo ?? null;

  /**
   * Patches one band by index.
   * @param i - Band index.
   * @param patch - Fields to merge into that band.
   */
  const update = (i: number, patch: Partial<TaxBracket>): void => {
    onChange(brackets.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  };

  /**
   * Removes a band. Whatever ends up last becomes the open-ended top band.
   * @param i - Band index.
   */
  const remove = (i: number): void => {
    const next = brackets.filter((_, idx) => idx !== i);
    onChange(next.map((b, idx) => (idx === next.length - 1 ? { ...b, upTo: null } : b)));
  };

  /** Adds a band just under the top band, one step above the band before it. */
  const add = (): void => {
    const below = brackets.slice(0, Math.max(last, 0));
    const prevLimit = below[below.length - 1]?.upTo ?? 0;
    const top = brackets[last] ?? { upTo: null, rate: 0 };
    onChange([...below, { upTo: prevLimit + NEW_BAND_STEP, rate: top.rate }, top]);
  };

  return (
    <FieldShell
      id="brackets"
      meta={TAX_FIELD_META.brackets}
      error={fieldErrors.brackets}
      customised={customised}
    >
      <div className="space-y-2">
        {brackets.map((b, i) => {
          const upToErr = fieldErrors[`brackets.${i}.upTo`];
          const rateErr = fieldErrors[`brackets.${i}.rate`];
          const isTop = i === last;
          return (
            <div key={i}>
              <div className="flex flex-wrap items-center gap-2">
                {isTop ? (
                  <span className="w-44 text-sm text-admin-text-secondary">
                    {topFloor === null ? "All income" : `Over ${dollars(topFloor)}`}
                  </span>
                ) : (
                  <>
                    <span className="text-sm text-admin-text-secondary">Up to $</span>
                    <AdminInput
                      id={i === 0 ? "brackets" : undefined}
                      aria-label={`Band ${i + 1} upper limit`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step="any"
                      value={b.upTo ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const n = Number(raw);
                        if (raw === "") update(i, { upTo: null });
                        else if (Number.isFinite(n)) update(i, { upTo: n });
                      }}
                      aria-invalid={upToErr ? true : undefined}
                      className={cn("w-32", upToErr && "border-coquelicot-600")}
                    />
                  </>
                )}
                <AdminInput
                  id={i === 0 && isTop ? "brackets" : undefined}
                  aria-label={`Band ${i + 1} rate`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="any"
                  // Stored as a fraction; shown + edited as a percent (2dp keeps 10.5% and 17.5%).
                  value={Math.round(b.rate * 10000) / 100}
                  onChange={(e) => {
                    const n = e.target.value === "" ? 0 : Number(e.target.value);
                    if (Number.isFinite(n)) update(i, { rate: n / 100 });
                  }}
                  aria-invalid={rateErr ? true : undefined}
                  className={cn("w-24", rateErr && "border-coquelicot-600")}
                />
                <span className="text-sm text-admin-muted">%</span>
                <AdminButton
                  type="button"
                  variant="danger"
                  size="xs"
                  aria-label={`Remove band ${i + 1}`}
                  disabled={brackets.length <= 1}
                  onClick={() => remove(i)}
                >
                  Remove
                </AdminButton>
              </div>
              {(upToErr ?? rateErr) && (
                <p className="mt-1 text-sm font-medium text-red-600">{upToErr ?? rateErr}</p>
              )}
            </div>
          );
        })}
      </div>
      <AdminButton
        type="button"
        size="sm"
        variant="secondary"
        className="mt-3"
        disabled={brackets.length >= MAX_TAX_BANDS}
        onClick={add}
      >
        + Add band
      </AdminButton>
    </FieldShell>
  );
}
