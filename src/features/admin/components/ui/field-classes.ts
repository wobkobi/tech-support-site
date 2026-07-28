// src/features/admin/components/ui/field-classes.ts
// Tailwind class strings for admin form controls. Kept as consts rather than a
// component because the same string is applied to input, select and textarea
// interchangeably, which a wrapper would have to forward three prop unions for.

/** Full-width admin text input / select / textarea. */
export const ADMIN_INPUT_CLS =
  "w-full rounded-lg border border-admin-border-strong bg-admin-surface px-3 py-2 text-sm text-admin-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-russian-violet";

/** Fixed-height variant used for filter-bar controls that sit next to buttons. */
export const ADMIN_CONTROL_CLS = `h-9 ${ADMIN_INPUT_CLS}`;
