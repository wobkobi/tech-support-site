// src/shared/lib/business-identity.ts
/**
 * @file business-identity.ts
 * @description Business identity used across emails, invoices, contact surfaces.
 * Bank account read from `NEXT_PUBLIC_BUSINESS_BANK_ACCOUNT` so the literal stays out of git.
 */

export const BUSINESS = {
  /** Operator's display name. */
  name: "Harrison Raynes",
  /** Trading/company name. */
  company: "To The Point",
  /** Customer-facing email address. */
  email: "harrison@tothepoint.co.nz",
  /** Display phone with NZ formatting. */
  phone: "021 297 1237",
  /** Phone formatted for tel: links. */
  phoneTel: "tel:+64212971237",
  /** Locality used in signature blocks. */
  location: "Auckland, New Zealand",
  /** Public website URL (no scheme) shown on invoice footer. */
  website: "tothepoint.co.nz",
} as const;

/** NZ payment-terms window (days from issue) shown on invoice footer. */
export const BUSINESS_PAYMENT_TERMS_DAYS = 7;

/** GST# (env). When unset the invoice PDF skips the "Tax invoice" + GST block. */
export const BUSINESS_GST_NUMBER = process.env.NEXT_PUBLIC_BUSINESS_GST_NUMBER ?? "";

/**
 * Date the business started operating. Used to label the first NZ financial
 * year as "(partial)" on the business dashboard, since the business didn't
 * cover the full 1 April - 31 March span that year.
 */
export const BUSINESS_START_DATE = new Date("2025-10-01T00:00:00Z");

export const BUSINESS_BANK_ACCOUNT =
  process.env.NEXT_PUBLIC_BUSINESS_BANK_ACCOUNT ??
  "[BANK ACCOUNT NOT SET - configure NEXT_PUBLIC_BUSINESS_BANK_ACCOUNT]";
