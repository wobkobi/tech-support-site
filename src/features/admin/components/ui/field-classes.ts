// src/features/admin/components/ui/field-classes.ts
// Class strings for admin form controls, links, checkboxes and labels. Exported raw for
// shared inputs that take a class prop.

/**
 * Full-width admin input/select/textarea. Explicit disabled styles: the set colours
 * override the browser's own greying.
 */
export const ADMIN_INPUT_CLS =
  "w-full rounded-md border border-admin-border-strong bg-admin-surface px-3 py-2 text-[0.9375rem] text-admin-text focus:border-russian-violet disabled:cursor-not-allowed disabled:bg-admin-bg disabled:text-admin-muted";

/** Fixed-height variant used for filter-bar controls that sit next to buttons. */
export const ADMIN_CONTROL_CLS = `h-10 ${ADMIN_INPUT_CLS}`;

/** Label above an admin field: bold, like the public form labels. */
export const ADMIN_LABEL_CLS = "mb-1 block text-sm font-bold text-admin-text";

/** Small uppercase section label, the public site's eyebrow at admin size. */
export const ADMIN_EYEBROW_CLS = "text-sm font-bold tracking-[0.06em] text-moonstone-700 uppercase";

/** Muted uppercase label above a value on a detail card ("Email", "Starts"). */
export const ADMIN_META_LABEL_CLS = "text-sm font-semibold text-admin-muted uppercase";

/** Underlined violet admin text link; no text size, so it inherits the surrounding copy. */
export const ADMIN_LINK_CLS =
  "font-semibold text-russian-violet underline underline-offset-2 hover:decoration-2";

/** Native checkbox; `mt-0.5` aligns the 16px box with the first line of 14px label text. */
export const ADMIN_CHECKBOX_CLS = "mt-0.5 h-4 w-4 shrink-0 accent-russian-violet";
