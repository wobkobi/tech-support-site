// src/shared/components/Field.tsx
/**
 * @description Shared labelled form-field wrapper for admin/business forms. The
 * label is associated with its input via `htmlFor`, and a consistent
 * required/optional marker (red `*` or muted "(optional)") signals which fields
 * are mandatory the same way the public booking/review forms do.
 */

import type React from "react";

/**
 * Props for {@link Field}.
 */
interface FieldProps {
  /** Visible label text. */
  label: string;
  /** Input id the label associates with (must match the child input's id). */
  htmlFor: string;
  /** When true, appends a red `*` so the field reads as mandatory. */
  required?: boolean;
  /** When true, appends a muted "(optional)" marker. Ignored if `required`. */
  optional?: boolean;
  /** Field input element(s). */
  children: React.ReactNode;
  /** Optional extra classes on the wrapper (e.g. column spans in a grid). */
  className?: string;
}

/**
 * Renders a labelled form field with consistent spacing and a required/optional
 * marker. Used across admin forms so every form signals mandatory fields the
 * same way.
 * @param props - Field props.
 * @param props.label - Visible label text.
 * @param props.htmlFor - Input id the label associates with.
 * @param props.required - When true, appends a red `*`.
 * @param props.optional - When true, appends a muted "(optional)" marker.
 * @param props.children - Field input element(s).
 * @param props.className - Optional extra classes on the wrapper.
 * @returns Labelled field element.
 */
export function Field({
  label,
  htmlFor,
  required = false,
  optional = false,
  children,
  className,
}: FieldProps): React.ReactElement {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-slate-600">
        {label}
        {required && <span className="ml-0.5 text-coquelicot-500">*</span>}
        {!required && optional && (
          <span className="ml-1 font-normal text-slate-400">(optional)</span>
        )}
      </label>
      {children}
    </div>
  );
}
