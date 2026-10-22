// src/shared/lib/csv.ts
// CSV cells and line endings that spreadsheet apps read cleanly. Pure and client-safe.

/** Line ending spreadsheet apps expect in a CSV. */
export const CSV_EOL = "\r\n";

/** UTF-8 byte-order mark, so Excel reads the file as UTF-8 rather than the system code page. */
export const CSV_BOM = String.fromCharCode(0xfeff);

/**
 * Quotes a text cell, prefixing an apostrophe when it starts with =, +, -, @, tab or CR
 * so a spreadsheet doesn't run it as a formula.
 * @param value - Cell text.
 * @returns The quoted cell.
 */
export function csvText(value: string | null | undefined): string {
  let str = value ?? "";
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}
