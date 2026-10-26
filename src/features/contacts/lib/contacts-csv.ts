// src/features/contacts/lib/contacts-csv.ts
// Cells for the Google Contacts CSV export, guarded against spreadsheet formula injection.

/**
 * Escapes a value for CSV. A leading =, +, - or @ runs as a formula, so it gets a quote prefix
 * (values come from the public booking form).
 * @param value - The string to escape.
 * @returns CSV-safe cell.
 */
export function csvCell(value: string | null | undefined): string {
  let str = value ?? "";
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * A phone cell. Stored numbers are E.164 (+64...), and the formula guard's quote would land in
 * Google as part of the number; a + followed only by digits and spaces can't run as a formula.
 * @param value - The phone number.
 * @returns CSV-safe cell.
 */
export function csvPhone(value: string | null | undefined): string {
  const str = value ?? "";
  return /^\+[\d ]+$/.test(str) ? `"${str}"` : csvCell(str);
}
