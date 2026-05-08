// src/shared/lib/business-identity.ts
/**
 * @file business-identity.ts
 * @description Static business identity used across email signatures, invoices,
 * and contact surfaces. Safe to import from both server and client code.
 *
 * The bank account is read from NEXT_PUBLIC_BUSINESS_BANK_ACCOUNT so the literal
 * value is never committed to source. Set this in `.env.local` for development
 * and in Vercel project settings for production. If unset the placeholder makes
 * the gap obvious in any rendered invoice.
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
} as const;

/**
 * Date the business started operating. Used to label the first NZ financial
 * year as "(partial)" on the business dashboard, since the business didn't
 * cover the full 1 April - 31 March span that year.
 */
export const BUSINESS_START_DATE = new Date("2025-10-01T00:00:00Z");

export const BUSINESS_BANK_ACCOUNT =
  process.env.NEXT_PUBLIC_BUSINESS_BANK_ACCOUNT ??
  "[BANK ACCOUNT NOT SET - configure NEXT_PUBLIC_BUSINESS_BANK_ACCOUNT]";
