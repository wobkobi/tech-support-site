/**
 * @file invoice-email-defaults.ts
 * @description Default copy for the invoice email's editable body. Lives in its
 * own file so both the server (`buildInvoiceEmail`) and the client (the Send
 * modal in InvoiceActions.tsx) can import it without dragging server-only
 * dependencies into the client bundle.
 */

/** Default text rendered between the greeting and the auto-generated invoice details block. */
export const DEFAULT_INVOICE_EMAIL_BODY =
  "Thanks for the work, your invoice is attached as a PDF for your records.";
