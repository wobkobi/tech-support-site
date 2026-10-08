// src/features/admin/components/ui/field-classes.ts
// Tailwind class strings for admin form controls, in the public site's field style at
// admin density. The AdminInput / AdminSelect / AdminTextarea wrappers apply these; the
// raw strings stay exported for shared inputs that take a class prop (EmailInput,
// PhoneInput, AddressAutocomplete, ContactNameInput).

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
