"use client";
// src/features/social-design/components/editor-fields.tsx
// Small controls the post maker's panels share: brand swatches, number boxes, sliders,
// segmented choices, icon buttons and titled sections. Admin field styles throughout.

import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { SWATCHES, type ColourKey } from "@/features/social-design/lib/brand";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useId, useState } from "react";
import { FaBan } from "react-icons/fa6";

/**
 * A titled block in a panel.
 * @param props - Component props.
 * @param props.title - Section heading.
 * @param props.children - Section body.
 * @returns Section element.
 */
export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-2 border-t border-admin-border px-3 py-3 first:border-t-0">
      <h3 className="text-sm font-semibold text-admin-text">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Square button holding an icon, with the action as its tooltip and accessible name.
 * @param props - Component props.
 * @param props.label - What the button does.
 * @param props.onClick - Click handler.
 * @param props.active - Shows it as switched on.
 * @param props.disabled - Disables it.
 * @param props.children - The icon.
 * @returns Button element.
 */
export function IconButton({
  label,
  onClick,
  active = false,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md border text-admin-text transition-colors disabled:opacity-40",
        active
          ? "border-moonstone-600 bg-moonstone-100"
          : "border-admin-border bg-admin-surface hover:bg-admin-bg",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Row of brand colour swatches, optionally with a "none" choice.
 * @param props - Component props.
 * @param props.label - What the colour is for.
 * @param props.value - Picked swatch key, or null for none.
 * @param props.onChange - Picks a swatch.
 * @param props.allowNone - Whether "none" is offered.
 * @returns Swatch row.
 */
export function SwatchPicker({
  label,
  value,
  onChange,
  allowNone = false,
}: {
  label: string;
  value: ColourKey | null;
  onChange: (key: ColourKey | null) => void;
  allowNone?: boolean;
}): React.ReactElement {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm text-admin-text-secondary">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {allowNone && (
          <button
            type="button"
            aria-label="None"
            title="None"
            aria-pressed={value === null}
            onClick={() => onChange(null)}
            className={cn(
              "flex size-7 items-center justify-center rounded-full border border-admin-border-strong bg-admin-surface text-admin-muted",
              value === null && "ring-2 ring-moonstone-600 ring-offset-2",
            )}
          >
            <FaBan aria-hidden className="size-3.5" />
          </button>
        )}
        {SWATCHES.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-label={s.label}
            title={s.label}
            aria-pressed={value === s.key}
            onClick={() => onChange(s.key)}
            className={cn(
              "size-7 rounded-full border border-admin-border-strong",
              value === s.key && "ring-2 ring-moonstone-600 ring-offset-2",
            )}
            style={{ backgroundColor: s.hex }}
          />
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Labelled number box that only reports whole, in-range numbers, while letting the
 * operator type freely (a lone minus sign, an empty box) in between.
 * @param props - Component props.
 * @param props.label - Field label.
 * @param props.value - Current value.
 * @param props.onChange - Reports a new value.
 * @param props.min - Smallest value.
 * @param props.max - Largest value.
 * @param props.step - Arrow-key step.
 * @param props.decimals - Decimal places kept.
 * @returns Field element.
 */
export function NumField({
  label,
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  decimals = 0,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
}): React.ReactElement {
  const id = useId();
  const shown = String(Number(value.toFixed(decimals)));
  // While typing, the box shows what was typed (a half-typed "-" or "1." isn't a
  // number yet); otherwise it follows the value, so a drag on the canvas shows here.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <label htmlFor={id} className="text-sm text-admin-text-secondary">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={draft ?? shown}
        step={step}
        min={Number.isFinite(min) ? min : undefined}
        max={Number.isFinite(max) ? max : undefined}
        onFocus={() => setDraft(shown)}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() === "" || !Number.isFinite(n)) return;
          onChange(Math.min(max, Math.max(min, n)));
        }}
        className={cn(ADMIN_INPUT_CLS, "px-2 py-1")}
      />
    </div>
  );
}

/**
 * Labelled slider showing its value.
 * @param props - Component props.
 * @param props.label - Field label.
 * @param props.value - Current value.
 * @param props.onChange - Reports a new value.
 * @param props.min - Smallest value.
 * @param props.max - Largest value.
 * @param props.step - Step size.
 * @param props.format - Turns the value into the readout.
 * @returns Field element.
 */
export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  format = (v) => String(v),
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
}): React.ReactElement {
  const id = useId();
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-sm">
        <label htmlFor={id} className="text-admin-text-secondary">
          {label}
        </label>
        <span className="text-admin-muted tabular-nums">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-moonstone-600"
      />
    </div>
  );
}

/**
 * Row of mutually exclusive choices.
 * @param props - Component props.
 * @param props.label - What is being chosen.
 * @param props.options - Choices with their labels.
 * @param props.value - Picked choice.
 * @param props.onChange - Picks a choice.
 * @returns Choice row.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: React.ReactNode; title?: string }[];
  value: T;
  onChange: (value: T) => void;
}): React.ReactElement {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm text-admin-text-secondary">{label}</legend>
      <div className="flex overflow-hidden rounded-md border border-admin-border-strong">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            title={o.title}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex flex-1 items-center justify-center px-2 py-1.5 text-sm transition-colors not-first:border-l not-first:border-admin-border",
              value === o.value
                ? "bg-russian-violet text-seasalt"
                : "bg-admin-surface text-admin-text hover:bg-admin-bg",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Checkbox with its label.
 * @param props - Component props.
 * @param props.label - Label text.
 * @param props.checked - Whether ticked.
 * @param props.onChange - Reports the new state.
 * @returns Label element.
 */
export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.ReactElement {
  return (
    <label className="flex items-center gap-2 text-sm text-admin-text">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-russian-violet"
      />
      {label}
    </label>
  );
}
