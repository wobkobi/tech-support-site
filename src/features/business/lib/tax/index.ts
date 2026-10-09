// src/features/business/lib/tax/index.ts
// Public surface of the tax maths library.

export {
  ASSET_CLASSES,
  VEHICLE_CLASS_KEY,
  assetClassByKey,
} from "@/features/business/lib/tax/asset-classes";
export {
  INVESTMENT_BOOST_RATE,
  assetSchedule,
  assetStartDay,
  lowValueGroupTotals,
} from "@/features/business/lib/tax/depreciation";
export {
  expenseGstRateOn,
  expenseTaxBasis,
  gstStatusFromPricing,
  incomeTaxBasis,
  isGstRegisteredOn,
} from "@/features/business/lib/tax/gst-basis";
export { roundCents } from "@/features/business/lib/tax/helpers";
export { homeOfficeClaim } from "@/features/business/lib/tax/home-office";
export {
  DEFAULT_IETC,
  DEFAULT_TAX_BRACKETS,
  incomeTaxOnBrackets,
  independentEarnerCredit,
} from "@/features/business/lib/tax/income-tax";
export { setAsideTargets } from "@/features/business/lib/tax/set-aside";
export { computeTaxYear, toTaxFy } from "@/features/business/lib/tax/tax-year";
export type * from "@/features/business/lib/tax/types";
export {
  KM_TIER1_LIMIT,
  inKmVehiclePeriod,
  kmClaim,
  kmVehiclePeriods,
  splitTripKm,
} from "@/features/business/lib/tax/vehicle";
export { IRD_YEAR_RATES, irdRatesFor } from "@/features/business/lib/tax/year-rates";
