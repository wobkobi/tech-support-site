/**
 * @description Default copy for the invoice email's editable body. Lives in its
 * own file so both the server (`buildInvoiceEmail`) and the client (the Send
 * modal in InvoiceActions.tsx) can import it without dragging server-only
 * dependencies into the client bundle.
 */

/** Default text rendered between the greeting and the auto-generated invoice details block. */
export const DEFAULT_INVOICE_EMAIL_BODY =
  "Thanks so much for the work - I really appreciate you choosing me for your tech support. Your invoice is attached below.";

/** Default intro for quote emails - acceptance instructions live in the details block + PDF. */
export const DEFAULT_QUOTE_EMAIL_BODY =
  "Thanks for getting in touch - your quote is attached. If you're happy with it, just reply to this email or give me a ring and I'll get it booked in.";

/**
 * Default body for the "your invoice has been voided" notification email.
 * Sent atomically when the operator voids a SENT or PAID invoice and ticks the
 * notify checkbox; the attached PDF carries the diagonal VOID stamp so the
 * client sees the cancellation visually as well.
 */
export const DEFAULT_VOID_EMAIL_BODY =
  "I'm writing to let you know that the invoice I sent you has been voided and should be disregarded. " +
  "Please ignore the previous PDF and email. If you've already paid, please reply so I can sort out a refund. " +
  "A corrected invoice will follow shortly. Sorry for the confusion - thanks for your patience.";
