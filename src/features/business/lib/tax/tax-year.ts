// src/features/business/lib/tax/tax-year.ts
// One FY's sole-trader income tax estimate: income, deductions, tax, IETC, ACC and IR3/IR10 figures.

import type { EXPENSE_CATEGORIES } from "@/features/business/lib/constants";
import {
  APRIL,
  DAY_MS,
  fyKeyOf,
  getFinancialYear,
  type FinancialYear,
} from "@/features/business/lib/financial-year";
import {
  assetSchedule,
  assetStartDay,
  filedAtvFor,
  lowValueGroupTotals,
} from "@/features/business/lib/tax/depreciation";
import {
  expenseTaxBasis,
  incomeTaxBasis,
  isGstRegisteredOn,
} from "@/features/business/lib/tax/gst-basis";
import { inFy, pctFraction, roundCents } from "@/features/business/lib/tax/helpers";
import { homeOfficeClaim } from "@/features/business/lib/tax/home-office";
import {
  incomeTaxOnBrackets,
  independentEarnerCredit,
} from "@/features/business/lib/tax/income-tax";
import type {
  AssetYearRow,
  DeductionLine,
  TaxFy,
  TaxYearInput,
  TaxYearResult,
} from "@/features/business/lib/tax/types";
import {
  inKmVehiclePeriod,
  kmClaim,
  kmVehiclePeriods,
  splitTripKm,
} from "@/features/business/lib/tax/vehicle";

/** Categories IRD's km rate already covers (parking and tolls aren't, so stay in Travel). */
const KM_RATE_CATEGORIES: ReadonlySet<string> = new Set<(typeof EXPENSE_CATEGORIES)[number]>([
  "Fuel",
  "Vehicle",
]);

/**
 * The tax maths' view of a financial year.
 * @param fy - A year from {@link getFinancialYear} or listFinancialYears.
 * @returns Key, bounds and current flag.
 */
export function toTaxFy(fy: FinancialYear): TaxFy {
  return { key: fyKeyOf(fy.label), start: fy.start, end: fy.end, current: fy.current };
}

/**
 * Every FY from the business start through `fy`: the span an asset schedule carries values over.
 * @param businessStart - Business start date.
 * @param fy - The last FY wanted.
 * @param now - Current instant (for the `current` flag).
 * @returns The FYs, oldest first.
 */
function fysThrough(businessStart: Date, fy: TaxFy, now: Date): TaxFy[] {
  const firstYear = getFinancialYear(businessStart, now, businessStart).start.getUTCFullYear();
  const lastYear = fy.start.getUTCFullYear();
  const out: TaxFy[] = [];
  for (let y = Math.min(firstYear, lastYear); y <= lastYear; y++) {
    out.push(toTaxFy(getFinancialYear(new Date(Date.UTC(y, APRIL, 1)), now, businessStart)));
  }
  return out;
}

/**
 * Computes one FY's tax estimate. Rows count on the GST basis for their date; expenses are
 * scaled by category business %, skipping asset-linked rows and Fuel/Vehicle rows dated in a
 * km-rate vehicle period. Asset schedules run from the business-start FY, as the Assets page does.
 * @param input - Ledger rows, register, trips, the FY's TaxYear figures, settings and GST status.
 * @returns The estimate, its deductions breakdown and the IR3/IR10 figures.
 */
export function computeTaxYear(input: TaxYearInput): TaxYearResult {
  const { fy, settings } = input;

  // Income: GST-exclusive from the registration date
  const income = roundCents(
    input.income
      .filter((r) => inFy(r.date, fy))
      .reduce((s, r) => s + incomeTaxBasis(r, input.gst), 0),
  );

  // Expenses: GST basis x category business %, after the two exclusions
  const linkedExpenseIds = new Set(
    input.assets.map((a) => a.expenseId).filter((id): id is string => id !== null),
  );
  const kmPeriods = kmVehiclePeriods(input.assets);
  let expenses = 0;
  let excludedFuel = 0;
  let excludedAssetLinked = 0;
  for (const row of input.expenses) {
    if (!inFy(row.date, fy)) continue;
    const basis = expenseTaxBasis(row, input.gst);
    if (linkedExpenseIds.has(row.id)) {
      excludedAssetLinked += basis;
    } else if (KM_RATE_CATEGORIES.has(row.category) && inKmVehiclePeriod(row.date, kmPeriods)) {
      excludedFuel += basis;
    } else {
      expenses += basis * pctFraction(settings.categoryBusinessUse[row.category] ?? 100);
    }
  }

  // Assets: schedule each from the business-start FY, keep this FY's row
  const fys = fysThrough(input.businessStart, fy, input.now);
  const groupTotals = lowValueGroupTotals(input.assets);
  const assetRows: AssetYearRow[] = [];
  let depreciation = 0;
  let lowValueWriteOffs = 0;
  let investmentBoost = 0;
  let recoveryIncome = 0;
  let lossOnDisposal = 0;
  let additions = 0;
  let disposals = 0;
  let boostValue = 0;
  for (const asset of input.assets) {
    const row = assetSchedule(asset, fys, {
      businessStart: input.businessStart,
      lowValueThreshold: settings.lowValueThreshold,
      groupTotal: groupTotals.get(asset.id) ?? asset.costBase,
      filedClosingAtv: filedAtvFor(asset.id, input.filedClosingAtv),
    }).find((r) => r.fyKey === fy.key);
    if (!row) continue;
    assetRows.push(row);
    const boostShare = roundCents(row.investmentBoost * pctFraction(asset.businessUsePct));
    if (row.writtenOff) {
      lowValueWriteOffs += row.deductible;
    } else {
      investmentBoost += boostShare;
      depreciation += row.deductible - boostShare;
    }
    recoveryIncome += row.recoveryIncome;
    lossOnDisposal += row.lossOnDisposal;
    if (row.investmentBoost > 0) boostValue += asset.costBase;
    if (row.disposed) disposals += asset.disposalAmount ?? 0;
    if (inFy(assetStartDay(asset, input.businessStart), fy)) additions += asset.costBase;
  }

  // Vehicle: only trips on a day a km-rate vehicle was in service earn the rate
  const tripKm = splitTripKm(
    input.trips.filter((t) => inFy(t.date, fy)),
    kmPeriods,
  );
  const km = kmClaim(
    tripKm.claimableKm,
    { tier1: input.year.kmTier1, tier2: input.year.kmTier2 },
    input.year.totalVehicleKm,
  );
  const homeOffice = homeOfficeClaim(input.year);

  // Deduction totals and breakdown lines. The Expenses note checks the FY's last day,
  // since a registration after the FY leaves every row GST-inclusive.
  const registeredInFy = isGstRegisteredOn(new Date(fy.end.getTime() - DAY_MS), input.gst);
  const deductions = {
    expenses: roundCents(expenses),
    excludedFuel: roundCents(excludedFuel),
    excludedAssetLinked: roundCents(excludedAssetLinked),
    unclaimedKm: tripKm.outsideKm,
    depreciation: roundCents(depreciation),
    lowValueWriteOffs: roundCents(lowValueWriteOffs),
    investmentBoost: roundCents(investmentBoost),
    km: km.amount,
    homeOffice: homeOffice.amount,
    lossOnDisposal: roundCents(lossOnDisposal),
  };
  const total = roundCents(
    deductions.expenses +
      deductions.depreciation +
      deductions.lowValueWriteOffs +
      deductions.investmentBoost +
      deductions.km +
      deductions.homeOffice +
      deductions.lossOnDisposal,
  );
  const lines: DeductionLine[] = [
    {
      key: "expenses",
      label: "Expenses",
      amount: deductions.expenses,
      note: registeredInFy ? "GST-exclusive from the registration date" : "GST-inclusive",
    },
    { key: "depreciation", label: "Depreciation", amount: deductions.depreciation },
    { key: "low-value", label: "Low-value write-offs", amount: deductions.lowValueWriteOffs },
    { key: "investment-boost", label: "Investment Boost", amount: deductions.investmentBoost },
    {
      key: "km",
      label: "Vehicle (km rates)",
      amount: deductions.km,
      note: `${km.businessKm.toLocaleString("en-NZ")} business km`,
    },
    { key: "home-office", label: "Home office", amount: deductions.homeOffice },
    { key: "loss-on-disposal", label: "Loss on disposal", amount: deductions.lossOnDisposal },
  ];

  // Tax
  const recovery = roundCents(recoveryIncome);
  const profit = roundCents(income + recovery - total);
  const taxable = Math.max(0, profit);
  const incomeTax = incomeTaxOnBrackets(taxable, settings.brackets);
  const ietc = independentEarnerCredit(taxable, settings.ietc);
  const residualIncomeTax = roundCents(Math.max(0, incomeTax - ietc));
  const acc = roundCents(taxable * (input.year.accRate ?? settings.acc));
  const kiwiSaver = roundCents(taxable * settings.kiwiSaver);

  return {
    fyKey: fy.key,
    income,
    recoveryIncome: recovery,
    deductions: { ...deductions, total, lines },
    profit,
    taxable,
    incomeTax,
    ietc,
    residualIncomeTax,
    acc,
    kiwiSaver,
    totalToSetAside: roundCents(residualIncomeTax + acc),
    provisionalWarning: residualIncomeTax > settings.provisionalThreshold,
    assets: assetRows,
    km,
    homeOffice,
    ir: {
      ir3NetIncome: profit,
      ir10Box52Depreciation: roundCents(
        deductions.depreciation + deductions.lowValueWriteOffs + deductions.investmentBoost,
      ),
      ir10Box54Additions: roundCents(additions),
      ir10Box55Disposals: roundCents(disposals),
      ir10Box59LossOnDisposal: deductions.lossOnDisposal,
      ir10Box60BoostValue: roundCents(boostValue),
    },
  };
}
