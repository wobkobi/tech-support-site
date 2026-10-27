// src/features/business/lib/invoice-email-defaults.ts
// Default invoice email bodies, kept free of server-only imports so the client can use them.

/** Default text rendered between the greeting and the auto-generated invoice details block. */
export const DEFAULT_INVOICE_EMAIL_BODY =
  "Thanks for choosing me for your tech support - I really appreciate it. Your invoice is attached below.";

/** Default intro for quote emails - acceptance instructions live in the details block + PDF. */
export const DEFAULT_QUOTE_EMAIL_BODY =
  "Thanks for getting in touch - your quote is attached. If you're happy with it, just reply to this email or give me a ring and I'll get it booked in.";

/** Default body for the "your invoice has been voided" email (PDF attached with a VOID stamp). */
export const DEFAULT_VOID_EMAIL_BODY =
  "I'm writing to let you know that the invoice I sent you has been voided, so please ignore it and its PDF - there's nothing to pay on it. " +
  "A corrected invoice will follow shortly. If you've already paid it, just reply and let me know, and I'll take what you paid off the corrected invoice or refund you. " +
  "Sorry for the confusion - thanks for your patience.";
