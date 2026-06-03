"use client";
// src/features/admin/components/settings/SettingsFields.tsx
/**
 * @file SettingsFields.tsx
 * @description Reusable settings inputs shared by every settings tab. Each field
 * renders its title, a plain-English description, the unit, an optional "what
 * off does" note, and an inline validation error - sourced from `field-meta`.
 * Inputs are sized larger than the app default for the older admin audience.
 */

import type React from "react";
import { cn } from "@/shared/lib/cn";
import type { FieldMeta } from "@/shared/lib/settings/field-meta";

interface FieldShellProps {
  id: string;
  meta: FieldMeta;
  /** Inline validation error for this field, if any. */
  error?: string;
  /** True when the value differs from its default (shows a subtle marker). */
  customised?: boolean;
  children: React.ReactNode;
}

/**
 * Wraps a control with its label, description, off-note, and error message.
 * @param props - Component props.
 * @param props.id - Input id the label points at.
 * @param props.meta - Field metadata (title/description/unit/off).
 * @param props.error - Inline validation error to show, if any.
 * @param props.customised - Whether the value differs from default.
 * @param props.children - The input control.
 * @returns Field row element.
 */
export function FieldShell({
  id,
  meta,
  error,
  customised,
  children,
}: FieldShellProps): React.ReactElement {
  return (
    <div className={cn("py-4")}>
      <label htmlFor={id} className={cn("flex items-baseline justify-between gap-3")}>
        <span className={cn("text-russian-violet text-sm font-semibold")}>
          {meta.title}
          {customised && (
            <span
              className={cn("ml-2 align-middle text-xs font-normal text-amber-600")}
              title="Changed from the default"
            >
              edited
            </span>
          )}
        </span>
      </label>
      <p className={cn("mt-0.5 text-sm text-slate-500")}>{meta.description}</p>
      {meta.off && <p className={cn("mt-0.5 text-xs italic text-slate-400")}>{meta.off}</p>}
      <div className={cn("mt-2")}>{children}</div>
      {error && <p className={cn("mt-1 text-xs font-medium text-red-600")}>{error}</p>}
    </div>
  );
}

interface NumberFieldProps {
  id: string;
  meta: FieldMeta;
  value: number | null;
  onChange: (value: number | null) => void;
  /** When true an empty input means `null` (disabled); otherwise it coerces to 0. */
  nullable?: boolean;
  min?: number;
  max?: number;
  step?: number;
  error?: string;
  customised?: boolean;
}

/**
 * Numeric settings input with unit suffix and blank-means-off handling.
 * @param props - Component props.
 * @param props.id - Input id.
 * @param props.meta - Field metadata.
 * @param props.value - Current numeric value (or null when disabled).
 * @param props.onChange - Called with the parsed value (or null when blank + nullable).
 * @param props.nullable - Whether blank maps to null rather than 0.
 * @param props.min - Minimum accepted value.
 * @param props.max - Maximum accepted value.
 * @param props.step - Input step.
 * @param props.error - Inline validation error.
 * @param props.customised - Whether the value differs from default.
 * @returns Number field element.
 */
export function NumberField({
  id,
  meta,
  value,
  onChange,
  nullable,
  min,
  max,
  step,
  error,
  customised,
}: NumberFieldProps): React.ReactElement {
  return (
    <FieldShell id={id} meta={meta} error={error} customised={customised}>
      <div className={cn("flex items-center gap-2")}>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={value ?? ""}
          min={min}
          max={max}
          step={step ?? "any"}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(nullable ? null : 0);
              return;
            }
            const n = Number(raw);
            if (Number.isFinite(n)) onChange(n);
          }}
          className={cn(
            "focus:ring-russian-violet/30 w-32 rounded-lg border px-3 py-2.5 text-base focus:outline-none focus:ring-2",
            error ? "border-red-400" : "border-slate-300",
          )}
        />
        {meta.unit && <span className={cn("text-sm text-slate-500")}>{meta.unit}</span>}
      </div>
    </FieldShell>
  );
}

interface ToggleFieldProps {
  id: string;
  meta: FieldMeta;
  value: boolean;
  onChange: (value: boolean) => void;
  customised?: boolean;
}

/**
 * Boolean settings toggle rendered as a labelled switch.
 * @param props - Component props.
 * @param props.id - Input id.
 * @param props.meta - Field metadata.
 * @param props.value - Current on/off state.
 * @param props.onChange - Called with the new state.
 * @param props.customised - Whether the value differs from default.
 * @returns Toggle field element.
 */
export function ToggleField({
  id,
  meta,
  value,
  onChange,
  customised,
}: ToggleFieldProps): React.ReactElement {
  return (
    <FieldShell id={id} meta={meta} customised={customised}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={cn(
          "relative inline-flex h-7 w-12 items-center rounded-full transition-colors",
          value ? "bg-russian-violet" : "bg-slate-300",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 rounded-full bg-white shadow transition-[translate]",
            value ? "translate-x-6" : "translate-x-1",
          )}
        />
      </button>
      <span className={cn("ml-3 align-middle text-sm text-slate-600")}>{value ? "On" : "Off"}</span>
    </FieldShell>
  );
}
