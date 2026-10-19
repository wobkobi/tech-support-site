// src/features/admin/lib/contact-fields.ts
// Per-field validation for the name, email and phone on admin edit forms.

import { validateEmail } from "@/features/booking/lib/booking";
import { validatePhone } from "@/shared/lib/normalise-phone";

/** A contact field a save can reject. */
export type ContactField = "name" | "email" | "phone";

/** One message per rejected field; an absent key means the field is fine. */
export type ContactFieldErrors = Partial<Record<ContactField, string>>;

/** Order the fields sit in on every form, so the first error is the top one. */
const FIELD_ORDER: readonly ContactField[] = ["name", "email", "phone"];

/**
 * Checks the fields a form has (undefined is skipped). A blank phone is always fine.
 * @param fields - The form's current values.
 * @param fields.name - Name, required when present.
 * @param fields.email - Email address.
 * @param fields.phone - Phone number, optional.
 * @param options - Per-form rules.
 * @param options.emailRequired - Whether a blank email is an error.
 * @returns The errors; empty when the form can be saved.
 */
export function checkContactFields(
  fields: { name?: string; email?: string; phone?: string },
  { emailRequired }: { emailRequired: boolean },
): ContactFieldErrors {
  const errors: ContactFieldErrors = {};
  if (fields.name !== undefined && !fields.name.trim()) errors.name = "Enter a name.";
  if (fields.email !== undefined) {
    const result = validateEmail(fields.email);
    if (result === "empty" && emailRequired) errors.email = "Enter an email address.";
    else if (result === "invalid") errors.email = "Enter a valid email address.";
    else if (result === "too-long") errors.email = "That email address is too long.";
  }
  if (fields.phone !== undefined && validatePhone(fields.phone).result === "invalid") {
    errors.phone = "Enter a valid phone number, or leave it blank.";
  }
  return errors;
}

/**
 * Focuses the topmost field with an error. Client-only.
 * @param errors - The errors from {@link checkContactFields}.
 * @param ids - DOM id of each field's input.
 * @returns True when there was an error to focus.
 */
export function focusFirstInvalid(
  errors: ContactFieldErrors,
  ids: Partial<Record<ContactField, string>>,
): boolean {
  const first = FIELD_ORDER.find((key) => errors[key]);
  if (!first) return false;
  const id = ids[first];
  if (id) document.getElementById(id)?.focus();
  return true;
}
