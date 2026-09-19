// src/features/admin/components/ui/FieldError.tsx
// Inline error under an admin form control. The control points at it with
// aria-describedby={id} while it shows. Server-safe (no client hooks).

import type React from "react";

/**
 * Error message under a form control; renders nothing without a message.
 * @param props - Component props.
 * @param props.id - DOM id the control's aria-describedby references.
 * @param props.message - The error, or undefined when the field is fine.
 * @returns The message element, or null.
 */
export function FieldError({
  id,
  message,
}: {
  id: string;
  message: string | undefined;
}): React.ReactElement | null {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm text-error">
      {message}
    </p>
  );
}
