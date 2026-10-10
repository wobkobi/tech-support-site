// src/features/admin/components/ui/field-classes.ts
// Tailwind class strings for admin form controls, in the public site's field style at
// admin density. The AdminInput / AdminSelect / AdminTextarea wrappers apply these; the
// raw strings stay exported for shared inputs that take a class prop (EmailInput,
// PhoneInput, AddressAutocomplete, ContactNameInput). Also the admin text link, the
// native checkbox and the small uppercase meta label, so every page draws them the same.

/**
 * Full-width admin text input / select / textarea. Focus is a violet border plus the
 * admin-wide moonstone outline from globals.css, as on the public booking form. The
 * disabled styles are needed because the explicit surface and text colours override the
 * browser's own greying, which would otherwise leave a locked field looking editable.
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

/**
 * Underlined violet text link, the one admin link style (booking detail, ledger rows,
 * contact emails). Carries no text size, so it inherits the surrounding copy; add
 * `text-sm` where the link sits outside 14px text.
 */
export const ADMIN_LINK_CLS =
  "font-semibold text-russian-violet underline underline-offset-2 hover:decoration-2";

/**
 * Native checkbox beside a label that may wrap: `mt-0.5` lines the 16px box up with the
 * first line of 14px text in an `items-start` row, and `shrink-0` stops a long label
 * squeezing it.
 */
export const ADMIN_CHECKBOX_CLS = "mt-0.5 h-4 w-4 shrink-0 accent-russian-violet";
