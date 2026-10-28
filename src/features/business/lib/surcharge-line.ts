// src/features/business/lib/surcharge-line.ts
// Spots the weekend, public-holiday or after-hours surcharge line on a saved invoice, so a
// re-issue or a draft re-price knows whether it was billed.

// The line as jobToLineItems prints it, "Weekend surcharge (+$10/hr)", or the percent form
// older invoices carry, "Weekend surcharge (+10%)".
const SURCHARGE_LINE = /surcharge \(\+(?:\d+(?:\.\d+)?%|\$\d+(?:\.\d+)?\/hr)\)$/i;

/**
 * Whether an invoice line is the weekend, public-holiday or after-hours surcharge.
 * @param description - The line's description.
 * @returns True for the surcharge line.
 */
export function isSurchargeLine(description: string): boolean {
  return SURCHARGE_LINE.test(description.trim());
}
