// Bank transfer fields for the invoice's payment call-out. NZ internet banking gives the payer
// three boxes - Particulars, Code, Reference - each capped at 12 characters, so a full invoice
// number (TTP-2627-0042, 13 characters) is silently truncated when pasted into one of them.

/** Character cap on each of the payer's Particulars, Code and Reference fields. */
export const BANK_FIELD_MAX = 12;

/**
 * Trims a value to what a bank field accepts: letters, digits, spaces and hyphens, capped at
 * {@link BANK_FIELD_MAX}. Banks reject or strip anything else, so drop it before the payer sees it.
 * @param value - Raw value to clean.
 * @returns The cleaned value, 12 characters or fewer.
 */
function toBankField(value: string): string {
  return value
    .replace(/[^A-Za-z0-9 -]/g, "")
    .trim()
    .slice(0, BANK_FIELD_MAX)
    .trim();
}

/**
 * Marks a client name as a business rather than a person. A business's last word is its legal
 * suffix or a generic trade word ("Acme Plumbing Ltd"), so the first word names it instead.
 */
const BUSINESS_NAME =
  /&|\b(ltd|limited|inc|incorporated|co|company|trust|group|holdings|services|solutions|nz)\b/i;

/**
 * Picks the Particulars value that names the payer on the statement, since the statement itself
 * shows only an account number: a person's surname, or a business's first word. Falls back to the
 * single name given, and to "Payment" when nothing usable is left.
 * @param clientName - Client name as it appears on the invoice.
 * @returns Particulars value, 12 characters or fewer.
 */
export function bankParticulars(clientName: string): string {
  const parts = clientName.trim().split(/\s+/).filter(Boolean);
  // Skip a leading article so "The Rose Trust" reads as Rose, not The
  if (parts.length > 1 && /^the$/i.test(parts[0] ?? "")) parts.shift();
  const first = parts[0] ?? "";
  if (parts.length < 2) return toBankField(first) || "Payment";
  const last = parts[parts.length - 1] ?? "";
  return toBankField(BUSINESS_NAME.test(clientName) ? first : last) || "Payment";
}

/**
 * Builds the Code value from an invoice number by dropping the prefix every payment to the
 * business shares (TTP-2627-0042 > 2627-0042), which is what brings it under the field cap.
 * @param invoiceNumber - Invoice or quote number, e.g. "TTP-2627-0042".
 * @returns Code value, 12 characters or fewer.
 */
export function bankCode(invoiceNumber: string): string {
  return toBankField(invoiceNumber.replace(/^[A-Za-z]+-/, ""));
}
