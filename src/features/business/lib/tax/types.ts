// src/features/business/lib/tax/types.ts
// Shared shapes for the NZ sole-trader tax maths: loader inputs and the per-FY result.
// Money is NZD rounded to cents; rates are fractions (0.5 = 50%).

/** Diminishing value or straight line (IR260). */
export type DepreciationMethod = "DV" | "SL";

/** Brought in from private use at market value, or bought for the business. */
export type AssetOrigin = "introduced" | "purchased";

/** Fuel types IRD publishes kilometre rates for. */
export type VehicleFuel = "petrol" | "diesel" | "petrol-hybrid" | "electric";

/** One NZ financial year as the tax maths sees it. Bounds are UTC midnight 1 April (ledger scale). */
export interface TaxFy {
  /** "YYYY-YY", e.g. "2026-27". */
  key: string;
  /** Inclusive start (1 April). */
  start: Date;
  /** Exclusive end (the next 1 April). */
  end: Date;
  /** True when today falls inside this FY. */
  current: boolean;
}

/** One IR265 asset class the register offers in its class picker. */
export interface AssetClass {
  key: string;
  label: string;
  /** Picker heading the class sits under. */
  group: string;
  /** Diminishing-value rate. */
  dv: number;
  /** Straight-line rate. */
  sl: number;
  /** Estimated useful life in years (IR265). */
  lifeYears: number;
}

/** One register entry, as the maths needs it. */
export interface AssetInput {
  id: string;
  name: string;
  classKey: string;
  origin: AssetOrigin;
  /** Date first used or available for business use (ISO; NZ ledger date). */
  inServiceDate: string;
  /** Cost (purchased) or market value on inServiceDate (introduced), on the GST basis at entry. */
  costBase: number;
  /** Supplier, for the low-value same-supplier same-day grouping. Null for introduced. */
  supplier: string | null;
  method: DepreciationMethod;
  /** Annual rate as a fraction (0.5 = 50%). */
  rate: number;
  /** 0-100. */
  businessUsePct: number;
  investmentBoost: boolean;
  /** "km" = vehicle claimed on IRD kilometre rates: never depreciated, never written off. */
  vehicleMethod: "km" | null;
  disposedAt: string | null;
  disposalAmount: number | null;
  /** Linked ExpenseEntry id; a linked expense is excluded from expense deductions. */
  expenseId: string | null;
}

/** One asset's figures for one FY of its depreciation schedule. */
export interface AssetYearRow {
  assetId: string;
  fyKey: string;
  /** Months counted this FY (0-12; part month = whole month). */
  months: number;
  openingAtv: number;
  /** Full (100%) depreciation for the year, incl. any Investment Boost and low-value write-off. */
  depreciation: number;
  /** Investment Boost portion of `depreciation` (full, before business %). */
  investmentBoost: number;
  /** True when the asset was written off in full under the low-value rule this year. */
  writtenOff: boolean;
  /** Business share of depreciation: the deduction. */
  deductible: number;
  closingAtv: number;
  /** Business share of depreciation recovery on disposal this FY. */
  recoveryIncome: number;
  /** Business share of loss on disposal this FY. */
  lossOnDisposal: number;
  /** True in the FY the asset is disposed. */
  disposed: boolean;
}

/** Everything {@link AssetInput} alone can't tell the schedule. */
export interface AssetScheduleContext {
  businessStart: Date;
  lowValueThreshold: number;
  /** From lowValueGroupTotals(): combined cost of the asset's same-supplier same-day group. */
  groupTotal: number;
  /** Closing ATV per FY key from filed snapshots; when present for the FY before, it replaces the computed opening ATV. */
  filedClosingAtv: ReadonlyMap<string, number>;
}

/** GST registration as the tax maths reads it. */
export interface GstStatus {
  registered: boolean;
  /** ISO date registration took effect, or null = from business start. */
  registeredFrom: string | null;
}

/** One income-tax band. */
export interface TaxBracket {
  /** Upper bound of the band (inclusive), null for the top band. */
  upTo: number | null;
  rate: number;
}

/** Independent earner tax credit settings. */
export interface IetcConfig {
  enabled: boolean;
  /** Full annual credit. */
  annual: number;
  /** Lowest income that qualifies. */
  from: number;
  /** Highest income that still gets the full credit. */
  fullTo: number;
  /** Income above which nothing is paid. */
  cutoff: number;
  /** Credit lost per dollar of income above `fullTo`. */
  abatementPerDollar: number;
}

/** One kilometre-rate pair. */
export interface KmTierRates {
  /** Per business km within the first 14,000 km the vehicle travels in total. */
  tier1: number;
  /** Per business km beyond that. */
  tier2: number;
}

/** IRD rates published per tax year. */
export interface IrdYearRates {
  /** Home office square-metre rate. */
  sqmRate: number;
  km: Record<VehicleFuel, KmTierRates>;
}

/** Per-FY inputs from the TaxYear record, already merged with IRD_YEAR_RATES defaults. */
export interface TaxYearRecordInput {
  officeSqm: number | null;
  houseSqm: number | null;
  sqmRate: number;
  kmTier1: number;
  kmTier2: number;
  /** Total km (business and private) the km-rate vehicle travelled; over 14,000 it scales Tier 1 down. */
  totalVehicleKm?: number | null;
  /** The year's own ACC levy rate (changes each April); null uses `settings.acc`. */
  accRate?: number | null;
  /** Mortgage interest or rent for the year (whole house). */
  mortgageInterestOrRent: number | null;
  /** Council rates for the year (whole house). */
  rates: number | null;
}

/** The `settings.tax` fields the maths reads (the full shape is `TaxSettings` in the settings types). */
export interface TaxRulesSettings {
  brackets: TaxBracket[];
  ietc: IetcConfig;
  acc: number;
  kiwiSaver: number;
  lowValueThreshold: number;
  provisionalThreshold: number;
  vehicleFuel: VehicleFuel;
  /** Business-use percent (0-100) per expense category; missing = 100. */
  categoryBusinessUse: Record<string, number>;
}

/** An income row (ISO ledger date). */
export interface LedgerIncome {
  date: string;
  /** GST-inclusive amount, as entered. */
  amount: number;
}

/** An expense row (ISO ledger date) with both GST bases. */
export interface LedgerExpense {
  id: string;
  date: string;
  category: string;
  amountIncl: number;
  amountExcl: number;
  supplier: string;
  description: string;
}

/** A logged business trip (ISO ledger date). */
export interface LedgerTrip {
  date: string;
  km: number;
}

/** Everything {@link TaxYearResult} is computed from. */
export interface TaxYearInput {
  fy: TaxFy;
  businessStart: Date;
  /** ALL rows; computeTaxYear filters to the FY with the half-open ISO window. */
  income: readonly LedgerIncome[];
  expenses: readonly LedgerExpense[];
  assets: readonly AssetInput[];
  trips: readonly LedgerTrip[];
  year: TaxYearRecordInput;
  settings: TaxRulesSettings;
  gst: GstStatus;
  /** Closing ATV by FY key then asset id, from filed snapshots. */
  filedClosingAtv: ReadonlyMap<string, ReadonlyMap<string, number>>;
  now: Date;
}

/** One row of the deductions breakdown table. */
export interface DeductionLine {
  key: string;
  label: string;
  amount: number;
  note?: string;
}

/** Kilometre-rate claim for one FY. */
export interface KmClaim {
  businessKm: number;
  tier1Km: number;
  tier2Km: number;
  amount: number;
}

/** Half-open stretch [from, to) a km-rate vehicle is on the register, as ISO ledger dates. */
export interface KmVehiclePeriod {
  /** First day in service. */
  from: string;
  /** Disposal day (not covered), or null while the vehicle is still held. */
  to: string | null;
}

/** A trip list's km, split by whether a km-rate vehicle covered each trip's day. */
export interface TripKmSplit {
  /** Km on days inside a km-rate vehicle period: these earn the km rate. */
  claimableKm: number;
  /** Km on days no km-rate vehicle covers: not claimed. */
  outsideKm: number;
}

/** Home office claim for one FY. */
export interface HomeOfficeClaim {
  /** Office floor area as a fraction of the house (0-1). */
  officePct: number;
  sqmPart: number;
  proportionalPart: number;
  amount: number;
}

/** How much to put aside per week and per month to cover what is still owed. */
export interface SetAsidePlan {
  weeksLeft: number;
  monthsLeft: number;
  perWeek: number;
  perMonth: number;
}

/** Deduction totals for one FY. */
export interface TaxDeductions {
  /** Expense rows on the GST basis x category business %, after exclusions. */
  expenses: number;
  /** Fuel and Vehicle rows dated while on km rates. Name kept so stored snapshots validate. */
  excludedFuel: number;
  /** Rows linked to an asset. */
  excludedAssetLinked: number;
  /** Business km logged on days no km-rate vehicle was in service: not claimed. */
  unclaimedKm: number;
  /** Business share, excl. low-value write-offs and boost. */
  depreciation: number;
  /** Business share. */
  lowValueWriteOffs: number;
  /** Business share. */
  investmentBoost: number;
  km: number;
  homeOffice: number;
  lossOnDisposal: number;
  total: number;
  lines: DeductionLine[];
}

/** Figures the accountant copies into the IR3 and IR10. */
export interface IrFigures {
  /** IR3 Q24 net income. */
  ir3NetIncome: number;
  /** Tax depreciation incl. low-value write-offs and Investment Boost (business share). */
  ir10Box52Depreciation: number;
  /** Cost or market value of assets that came into service this FY. */
  ir10Box54Additions: number;
  /** Sale proceeds of assets disposed this FY. */
  ir10Box55Disposals: number;
  ir10Box59LossOnDisposal: number;
  /** Cost of assets Investment Boost was claimed on this FY. */
  ir10Box60BoostValue: number;
}

/** One FY's tax estimate. */
export interface TaxYearResult {
  fyKey: string;
  /** Income in the FY on the GST basis: GST-exclusive from the registration date. */
  income: number;
  recoveryIncome: number;
  deductions: TaxDeductions;
  /** income + recoveryIncome - deductions.total (can be negative). */
  profit: number;
  /** max(0, profit). */
  taxable: number;
  /** Progressive brackets on `taxable`. */
  incomeTax: number;
  /** Independent earner tax credit (subtracted). */
  ietc: number;
  /** max(0, incomeTax - ietc). */
  residualIncomeTax: number;
  /** taxable x acc. */
  acc: number;
  /** taxable x kiwiSaver (shown separately, not tax). */
  kiwiSaver: number;
  /** residualIncomeTax + acc. */
  totalToSetAside: number;
  /** residualIncomeTax > provisionalThreshold. */
  provisionalWarning: boolean;
  assets: AssetYearRow[];
  km: KmClaim;
  homeOffice: HomeOfficeClaim;
  ir: IrFigures;
}
