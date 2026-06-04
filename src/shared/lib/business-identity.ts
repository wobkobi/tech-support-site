// src/shared/lib/business-identity.ts
/**
 * @file business-identity.ts
 * @description Business start date used for financial-year labelling. The rest
 * of the business identity (name, contact, GST#, bank account, base address)
 * now lives in the settings panel - read it server-side via `getIdentity()`
 * in business-identity.server.ts.
 */

/**
 * Date the business started operating. Used to label the first NZ financial
 * year as "(partial)" on the business dashboard, since the business didn't
 * cover the full 1 April - 31 March span that year.
 */
export const BUSINESS_START_DATE = new Date("2025-10-01T00:00:00Z");
