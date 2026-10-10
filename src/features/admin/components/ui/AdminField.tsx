// src/features/admin/components/ui/AdminField.tsx
// Labelled admin form field. The label is associated with its input via `htmlFor`, and a
// consistent required/optional marker (red `*` or muted "(optional)") signals mandatory
// fields the same way the public booking/review forms do. Server-safe.

import { ADMIN_LABEL_CLS } from "@/features/admin/components/ui/field-classes";
import type React from "react";

/**
 * Props for {@link AdminField}.
 */
interface AdminFieldProps {
  /** Visible label text. */
  label: string;
  /** Input id the label associates with (must match the child input's id). */
  htmlFor: string;
  /** When true, appends a red `*` so the field reads as mandatory. */
  required?: boolean;
  /** When true, appends a muted "(optional)" marker. Ignored if `required`. */
  optional?: boolean;
  /** Optional help line under the input. */
  hint?: React.ReactNode;
  /** Field input element(s). */
  children: React.ReactNode;
  /** Optional extra classes on the wrapper (e.g. column spans in a grid). */
  className?: string;
}

/**
 * Renders a labelled form field with consistent spacing and a required/optional marker.
 * @param props - Field props.
 * @param props.label - Visible label text.
 * @param props.htmlFor - Input id the label associates with.
 * @param props.required - When true, appends a red `*`.
 * @param props.optional - When true, appends a muted "(optional)" marker.
 * @param props.hint - Optional help line under the input.
 * @param props.children - Field input element(s).
 * @param props.className - Optional extra classes on the wrapper.
 * @returns Labelled field element.
 */
export function AdminField({
  label,
  htmlFor,
  required = false,
  optional = false,
  hint,
  children,
  className,
}: AdminFieldProps): React.ReactElement {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className={ADMIN_LABEL_CLS}>
        {label}
        {required && <span className="ml-0.5 text-error">*</span>}
        {!required && optional && (
          <span className="ml-1 font-normal text-admin-muted">(optional)</span>
        )}
      </label>
      {children}
      {hint && <p className="mt-1 text-sm text-admin-muted">{hint}</p>}
    </div>
  );
}
