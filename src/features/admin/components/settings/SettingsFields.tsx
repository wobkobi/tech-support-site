"use client";
// src/features/admin/components/settings/SettingsFields.tsx
/**
 * @description Reusable settings inputs shared by every settings tab. Each field
 * renders its title, a plain-English description, the unit, an optional "what
 * off does" note, and an inline validation error - sourced from `field-meta`.
 * Inputs are sized larger than the app default for the older admin audience.
 */

import { cn } from "@/shared/lib/cn";
import type { FieldMeta } from "@/shared/lib/settings/field-meta";
import type React from "react";
import { useState } from "react";

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
    <div className="py-4">
      <label htmlFor={id} className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-russian-violet">
          {meta.title}
          {customised && (
            <span
              className="ml-2 align-middle text-xs font-normal text-amber-600"
              title="Changed from the default"
            >
              edited
            </span>
          )}
        </span>
      </label>
      <p className="mt-0.5 text-sm text-admin-muted">{meta.description}</p>
      {meta.off && <p className="mt-0.5 text-xs text-admin-faint italic">{meta.off}</p>}
      <div className="mt-2">{children}</div>
      {error && <p className="mt-1 text-xs font-medium text-coquelicot-500">{error}</p>}
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
  /** When the field is minutes, show a live "= 1h 30m" hint for values over an hour. */
  minutesHint?: boolean;
}

/**
 * Formats minutes as a friendly duration, e.g. 90 > "1h 30m", 120 > "2h".
 * @param mins - Whole minutes.
 * @returns Human-readable duration string.
 */
function formatMinutesHint(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
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
 * @param props.minutesHint - Whether to show a "= 1h 30m" hint for minute values over an hour.
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
  minutesHint,
}: NumberFieldProps): React.ReactElement {
  return (
    <FieldShell id={id} meta={meta} error={error} customised={customised}>
      <div className="flex items-center gap-2">
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
            "w-32 rounded-lg border px-3 py-2.5 text-base focus:ring-2 focus:ring-russian-violet/30 focus:outline-none",
            error ? "border-coquelicot-600" : "border-admin-border-strong",
          )}
        />
        {meta.unit && <span className="text-sm text-admin-muted">{meta.unit}</span>}
        {minutesHint && value != null && value >= 60 && (
          <span className="text-sm text-admin-faint">= {formatMinutesHint(value)}</span>
        )}
      </div>
    </FieldShell>
  );
}

interface TextFieldProps {
  id: string;
  meta: FieldMeta;
  value: string;
  onChange: (value: string) => void;
  /** Mask the value with a reveal toggle (bank account, GST number). */
  secret?: boolean;
  /** Render a multi-line textarea instead of a single-line input. */
  multiline?: boolean;
  /** HTML input type for single-line fields. */
  type?: "text" | "email" | "tel" | "url" | "date";
  placeholder?: string;
  error?: string;
  customised?: boolean;
}

/**
 * Text settings input. Supports masked secrets (with a show/hide toggle) and a
 * multi-line variant.
 * @param props - Component props.
 * @param props.id - Input id.
 * @param props.meta - Field metadata.
 * @param props.value - Current text value.
 * @param props.onChange - Called with the new text.
 * @param props.secret - Whether to mask the value behind a reveal toggle.
 * @param props.multiline - Whether to render a textarea.
 * @param props.type - HTML input type for single-line fields.
 * @param props.placeholder - Input placeholder.
 * @param props.error - Inline validation error.
 * @param props.customised - Whether the value differs from default.
 * @returns Text field element.
 */
export function TextField({
  id,
  meta,
  value,
  onChange,
  secret,
  multiline,
  type,
  placeholder,
  error,
  customised,
}: TextFieldProps): React.ReactElement {
  const [revealed, setRevealed] = useState(false);
  const inputClass = cn(
    "w-full rounded-lg border px-3 py-2.5 text-base focus:ring-2 focus:ring-russian-violet/30 focus:outline-none",
    error ? "border-coquelicot-600" : "border-admin-border-strong",
  );
  return (
    <FieldShell id={id} meta={meta} error={error} customised={customised}>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          rows={2}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      ) : (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type={secret && !revealed ? "password" : (type ?? "text")}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
          />
          {secret && (
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              className="shrink-0 rounded-lg border border-admin-border-strong px-3 py-2.5 text-sm text-admin-text-secondary hover:bg-admin-bg"
            >
              {revealed ? "Hide" : "Show"}
            </button>
          )}
        </div>
      )}
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
          value ? "bg-russian-violet" : "bg-admin-border-strong",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 rounded-full bg-admin-surface shadow transition-[translate]",
            value ? "translate-x-6" : "translate-x-1",
          )}
        />
      </button>
      <span className="ml-3 align-middle text-sm text-admin-text-secondary">
        {value ? "On" : "Off"}
      </span>
    </FieldShell>
  );
}
