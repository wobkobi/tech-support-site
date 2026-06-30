// src/shared/lib/settings/validate.ts
/**
 * @description Write-path validation for the settings panel. Two layers:
 *   1. {@link validateGroup} - per-field shape + bounds for one group (rejects garbage
 *      before it is stored).
 *   2. {@link checkGuardrails} - cross-setting coherence on the full proposed settings,
 *      classified BLOCK (would make bookings/invoices impossible) vs WARN (unusual
 *      but allowed). The same function powers the live-preview banner later.
 * Hand-rolled to match the repo's existing manual-validation convention (no zod).
 */

import type {
  AvailabilitySettings,
  CommsSettings,
  EstimatorSettings,
  HoldsSettings,
  IdentitySettings,
  PricingSettings,
  ReviewsSettings,
  SchedulingSettings,
  Settings,
  SettingsGroup,
  TaxSettings,
} from "@/shared/lib/settings/types";

/** A single rejected field plus the reason, surfaced inline by the form. */
export interface FieldError {
  field: string;
  message: string;
}

/** A coherence finding across groups. `block` rejects the save; `warn` confirms. */
export interface GuardrailIssue {
  level: "block" | "warn";
  message: string;
}

/**
 * Finite-number guard with an inclusive range.
 * @param n - Candidate value.
 * @param min - Lower bound (inclusive).
 * @param max - Upper bound (inclusive).
 * @returns Whether `n` is a finite number within `[min, max]`.
 */
function inRange(n: unknown, min: number, max: number): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
}

/**
 * True for a non-negative finite number (fees, minutes, counts that allow 0 = off).
 * @param n - Candidate value.
 * @returns Whether `n` is a finite number >= 0.
 */
function nonNeg(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/**
 * Validates the availability group's shape + bounds.
 * @param a - Proposed availability settings.
 * @returns List of field errors (empty when valid).
 */
function validateAvailability(a: AvailabilitySettings): FieldError[] {
  const errors: FieldError[] = [];
  if (typeof a.acceptingBookings !== "boolean")
    errors.push({ field: "acceptingBookings", message: "Must be on or off." });
  if (!inRange(a.maxAdvanceDays, 1, 365))
    errors.push({ field: "maxAdvanceDays", message: "Must be between 1 and 365 days." });
  if (!nonNeg(a.minHoursNotice))
    errors.push({ field: "minHoursNotice", message: "Must be 0 or more hours (0 = off)." });
  if (a.sameDayCutoffHour !== null && !inRange(a.sameDayCutoffHour, 0, 23))
    errors.push({
      field: "sameDayCutoffHour",
      message: "Must be an hour 0-23, or blank to disable.",
    });
  if (!nonNeg(a.bufferMin))
    errors.push({ field: "bufferMin", message: "Must be 0 or more minutes." });
  if (!nonNeg(a.bookingBufferAfterMin))
    errors.push({ field: "bookingBufferAfterMin", message: "Must be 0 or more minutes." });
  if (!inRange(a.durations?.short, 5, 600))
    errors.push({ field: "durations.short", message: "Standard duration must be 5-600 minutes." });
  if (!inRange(a.durations?.long, 5, 600))
    errors.push({ field: "durations.long", message: "Extended duration must be 5-600 minutes." });
  if (a.maxJobsPerDay !== null && !nonNeg(a.maxJobsPerDay))
    errors.push({
      field: "maxJobsPerDay",
      message: "Must be 0/blank (unlimited) or a positive count.",
    });
  if (a.maxBillableHoursPerDay !== null && !nonNeg(a.maxBillableHoursPerDay))
    errors.push({
      field: "maxBillableHoursPerDay",
      message: "Must be 0/blank (unlimited) or positive.",
    });
  if (!Array.isArray(a.subSlotMinutes) || a.subSlotMinutes.some((m) => !inRange(m, 0, 59)))
    errors.push({ field: "subSlotMinutes", message: "Each sub-slot offset must be 0-59." });

  for (let day = 0; day <= 6; day++) {
    const d = a.schedule?.[day];
    if (!d) {
      errors.push({ field: `schedule.${day}`, message: "Missing day window." });
      continue;
    }
    if (!d.enabled) continue;
    if (!inRange(d.open, 0, 23) || !inRange(d.close, 1, 24) || d.open >= d.close)
      errors.push({ field: `schedule.${day}`, message: "Open must be before close (hours 0-24)." });
    if (d.break) {
      if (
        !inRange(d.break.start, d.open, d.close) ||
        !inRange(d.break.end, d.open, d.close) ||
        d.break.start >= d.break.end
      )
        errors.push({
          field: `schedule.${day}.break`,
          message: "Break must sit inside the day's window.",
        });
    }
  }
  return errors;
}

/**
 * Validates the pricing group's shape + bounds.
 * @param p - Proposed pricing settings.
 * @returns List of field errors (empty when valid).
 */
function validatePricing(p: PricingSettings): FieldError[] {
  const errors: FieldError[] = [];
  if (typeof p.gstRegistered !== "boolean")
    errors.push({ field: "gstRegistered", message: "Must be on or off." });
  if (!nonNeg(p.minBillableMins))
    errors.push({ field: "minBillableMins", message: "Must be 0 or more minutes (0 = no floor)." });
  if (!inRange(p.billingIncrementMins, 1, 60))
    errors.push({ field: "billingIncrementMins", message: "Must be 1-60 minutes." });
  if (!inRange(p.publicHolidayUplift, 0, 5))
    errors.push({ field: "publicHolidayUplift", message: "Must be a fraction 0-5 (0 = off)." });
  if (!nonNeg(p.minTravelCharge))
    errors.push({ field: "minTravelCharge", message: "Must be 0 or more (0 = no floor)." });
  if (!nonNeg(p.cancellation?.freeNoticeHours))
    errors.push({ field: "cancellation.freeNoticeHours", message: "Must be 0 or more hours." });
  if (!nonNeg(p.cancellation?.travelChargeHours))
    errors.push({ field: "cancellation.travelChargeHours", message: "Must be 0 or more hours." });
  if (!nonNeg(p.cancellation?.callOutFee))
    errors.push({ field: "cancellation.callOutFee", message: "Must be 0 or more dollars." });
  if (typeof p.cancellation?.autoSendCancellationInvoice !== "boolean")
    errors.push({
      field: "cancellation.autoSendCancellationInvoice",
      message: "Must be on or off.",
    });
  if (!nonNeg(p.reschedule?.cutoffHours))
    errors.push({ field: "reschedule.cutoffHours", message: "Must be 0 or more hours (0 = off)." });
  if (p.reschedule?.maxReschedules !== null && !nonNeg(p.reschedule?.maxReschedules))
    errors.push({
      field: "reschedule.maxReschedules",
      message: "Must be 0/blank (no limit) or positive.",
    });
  return errors;
}

/** Upper bound on benchmark rows, to keep the estimator prompt a sane size. */
const MAX_BENCHMARKS = 40;

/**
 * Validates the estimator group: a list of task-duration benchmarks, each a
 * non-empty unique label plus a sane minute count.
 * @param e - Proposed estimator settings.
 * @returns List of field errors (empty when valid).
 */
function validateEstimator(e: EstimatorSettings): FieldError[] {
  const errors: FieldError[] = [];
  if (!Array.isArray(e.benchmarks)) {
    errors.push({ field: "benchmarks", message: "Must be a list of benchmarks." });
    return errors;
  }
  if (e.benchmarks.length === 0)
    errors.push({ field: "benchmarks", message: "Add at least one benchmark." });
  if (e.benchmarks.length > MAX_BENCHMARKS)
    errors.push({
      field: "benchmarks",
      message: `Keep it to ${MAX_BENCHMARKS} benchmarks or fewer.`,
    });
  const seen = new Set<string>();
  e.benchmarks.forEach((b, i) => {
    const label = typeof b?.label === "string" ? b.label.trim() : "";
    if (!label) {
      errors.push({ field: `benchmarks.${i}.label`, message: "Label is required." });
    } else if (label.length > 80) {
      errors.push({
        field: `benchmarks.${i}.label`,
        message: "Keep the label under 80 characters.",
      });
    } else {
      const key = label.toLowerCase();
      if (seen.has(key))
        errors.push({
          field: `benchmarks.${i}.label`,
          message: "Duplicate label - each must be unique.",
        });
      seen.add(key);
    }
    if (!inRange(b?.mins, 1, 1440))
      errors.push({ field: `benchmarks.${i}.mins`, message: "Minutes must be 1-1440." });
  });

  // Confidence-scaled range: each band's factors are fractions, high >= low.
  const range = e.range;
  if (!range || typeof range !== "object") {
    errors.push({ field: "range", message: "Range config is required." });
  } else {
    for (const level of ["high", "medium", "low"] as const) {
      const band = range[level];
      if (!band || !inRange(band.lowFactor, 0, 5) || !inRange(band.highFactor, 0, 5)) {
        errors.push({ field: `range.${level}`, message: "Low and high must be 0-500%." });
      } else if (band.highFactor < band.lowFactor) {
        errors.push({ field: `range.${level}`, message: "High % must be at least the low %." });
      }
    }
    if (!nonNeg(range.minSpread))
      errors.push({
        field: "range.minSpread",
        message: "Minimum spread must be 0 or more dollars.",
      });
  }
  return errors;
}

/**
 * Validates the comms group's shape + bounds.
 * @param c - Proposed comms settings.
 * @returns List of field errors (empty when valid).
 */
function validateComms(c: CommsSettings): FieldError[] {
  const errors: FieldError[] = [];
  for (const key of ["notifyConfirmation", "notifyReminder", "notifyReviewRequest"] as const) {
    if (typeof c[key] !== "boolean") errors.push({ field: key, message: "Must be on or off." });
  }
  if (!inRange(c.reminderLeadHours, 1, 168))
    errors.push({ field: "reminderLeadHours", message: "Must be 1-168 hours." });
  if (!nonNeg(c.reviewEmailDelayMins))
    errors.push({ field: "reviewEmailDelayMins", message: "Must be 0 or more minutes." });
  if (!inRange(c.priceEstimateRetentionDays, 1, 3650))
    errors.push({ field: "priceEstimateRetentionDays", message: "Must be 1-3650 days." });
  return errors;
}

/**
 * Validates the reviews group's shape + bounds.
 * @param r - Proposed reviews settings.
 * @returns List of field errors (empty when valid).
 */
function validateReviews(r: ReviewsSettings): FieldError[] {
  const errors: FieldError[] = [];
  if (!inRange(r.homepageFeaturedCount, 0, 50))
    errors.push({ field: "homepageFeaturedCount", message: "Must be 0-50 reviews." });
  if (typeof r.autoApproveVerified !== "boolean")
    errors.push({ field: "autoApproveVerified", message: "Must be on or off." });
  if (!inRange(r.invoiceReviewCooldownDays, 1, 3650))
    errors.push({ field: "invoiceReviewCooldownDays", message: "Must be 1-3650 days." });
  return errors;
}

/**
 * Validates the business identity group's shape + bounds.
 * @param i - Proposed identity settings.
 * @returns List of field errors (empty when valid).
 */
function validateIdentity(i: IdentitySettings): FieldError[] {
  const errors: FieldError[] = [];
  if (!i.name.trim()) errors.push({ field: "name", message: "Operator name is required." });
  if (!i.company.trim()) errors.push({ field: "company", message: "Business name is required." });
  if (!i.email.includes("@"))
    errors.push({ field: "email", message: "Enter a valid email address." });
  if (!nonNeg(i.paymentTermsDays))
    errors.push({ field: "paymentTermsDays", message: "Must be 0 or more days." });
  if (!i.invoicePrefix.trim())
    errors.push({ field: "invoicePrefix", message: "Invoice prefix is required." });
  if (i.baseAddress.lat !== null && !inRange(i.baseAddress.lat, -90, 90))
    errors.push({ field: "baseAddress.lat", message: "Latitude must be -90 to 90." });
  if (i.baseAddress.lng !== null && !inRange(i.baseAddress.lng, -180, 180))
    errors.push({ field: "baseAddress.lng", message: "Longitude must be -180 to 180." });
  return errors;
}

/**
 * Validates the booking form & holds group's shape + bounds.
 * @param h - Proposed holds settings.
 * @returns List of field errors (empty when valid).
 */
function validateHolds(h: HoldsSettings): FieldError[] {
  const errors: FieldError[] = [];
  if (!inRange(h.holdExpirationMinutes, 1, 240))
    errors.push({ field: "holdExpirationMinutes", message: "Must be 1-240 minutes." });
  return errors;
}

/**
 * Validates the tax-planner group's shape + bounds. Rates are fractions
 * (0.2 = 20%); weekly transfer amounts are non-negative dollar figures.
 * @param t - Proposed tax settings.
 * @returns List of field errors (empty when valid).
 */
function validateTax(t: TaxSettings): FieldError[] {
  const errors: FieldError[] = [];
  if (!inRange(t.incomeTax, 0, 1))
    errors.push({ field: "incomeTax", message: "Must be a fraction 0-1 (e.g. 0.2 = 20%)." });
  if (!inRange(t.acc, 0, 1))
    errors.push({ field: "acc", message: "Must be a fraction 0-1 (e.g. 0.0146 = 1.46%)." });
  if (!inRange(t.kiwiSaver, 0, 1))
    errors.push({ field: "kiwiSaver", message: "Must be a fraction 0-1 (e.g. 0.12 = 12%)." });
  if (!nonNeg(t.weeklyKiwiSaver))
    errors.push({ field: "weeklyKiwiSaver", message: "Must be 0 or more." });
  if (!nonNeg(t.weeklyTax)) errors.push({ field: "weeklyTax", message: "Must be 0 or more." });
  return errors;
}

/**
 * Validates the scheduling group's shape + bounds. All are non-negative
 * minute/hour buffers; 0 disables the rule each one gates.
 * @param s - Proposed scheduling settings.
 * @returns List of field errors (empty when valid).
 */
function validateScheduling(s: SchedulingSettings): FieldError[] {
  const errors: FieldError[] = [];
  if (!nonNeg(s.travelRoundBufferMin))
    errors.push({ field: "travelRoundBufferMin", message: "Must be 0 or more minutes." });
  if (!nonNeg(s.minHomeDwellMin))
    errors.push({
      field: "minHomeDwellMin",
      message: "Must be 0 or more minutes (0 = never suppress travel-back).",
    });
  if (!nonNeg(s.travelBackDepartureBufferMin))
    errors.push({ field: "travelBackDepartureBufferMin", message: "Must be 0 or more minutes." });
  if (!inRange(s.smartOriginLookaheadHours, 0, 24))
    errors.push({ field: "smartOriginLookaheadHours", message: "Must be 0-24 hours." });
  return errors;
}

/**
 * Validates one settings group's payload. Groups without a dedicated validator
 * yet fall through as valid (read-side clamping still guards them); the
 * highest-blast-radius groups are validated in full.
 * @param group - Which group is being saved.
 * @param value - Proposed value for that group.
 * @returns Field errors (empty when valid).
 */
export function validateGroup<G extends SettingsGroup>(group: G, value: Settings[G]): FieldError[] {
  switch (group) {
    case "availability":
      return validateAvailability(value as AvailabilitySettings);
    case "pricing":
      return validatePricing(value as PricingSettings);
    case "estimator":
      return validateEstimator(value as EstimatorSettings);
    case "comms":
      return validateComms(value as CommsSettings);
    case "reviews":
      return validateReviews(value as ReviewsSettings);
    case "holds":
      return validateHolds(value as HoldsSettings);
    case "identity":
      return validateIdentity(value as IdentitySettings);
    case "tax":
      return validateTax(value as TaxSettings);
    case "scheduling":
      return validateScheduling(value as SchedulingSettings);
    default:
      return [];
  }
}

/**
 * Cross-setting coherence checks on the full proposed settings. BLOCK issues
 * must stop the save; WARN issues should prompt a confirm. Named so the message
 * tells the operator exactly what would break.
 * @param s - The full settings with the edited group already applied.
 * @returns Guardrail issues (empty when fully coherent).
 */
export function checkGuardrails(s: Settings): GuardrailIssue[] {
  const issues: GuardrailIssue[] = [];
  const { availability: a, pricing: p, identity, comms } = s;
  const shortestJob = Math.min(a.durations.short, a.durations.long);
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Each enabled day's largest contiguous window must fit the shortest job + buffer.
  for (let day = 0; day <= 6; day++) {
    const d = a.schedule[day];
    if (!d?.enabled) continue;
    const segments = d.break ? [d.break.start - d.open, d.close - d.break.end] : [d.close - d.open];
    const largestMins = Math.max(...segments) * 60;
    if (largestMins < shortestJob + a.bookingBufferAfterMin) {
      issues.push({
        level: "block",
        message: `${dayNames[day]}'s open hours are shorter than the shortest job (${shortestJob} min) plus its after-buffer, so nobody could book ${dayNames[day]}.`,
      });
    }
  }

  // Notice that swallows the whole horizon leaves nothing bookable.
  if (a.minHoursNotice >= a.maxAdvanceDays * 24) {
    issues.push({
      level: "block",
      message: `Minimum notice (${a.minHoursNotice}h) is longer than the ${a.maxAdvanceDays}-day booking window, so no time would ever be bookable.`,
    });
  }

  // A daily hours cap below one job blocks every day.
  if (a.maxBillableHoursPerDay && a.maxBillableHoursPerDay * 60 < shortestJob) {
    issues.push({
      level: "block",
      message: `Daily hours cap (${a.maxBillableHoursPerDay}h) is smaller than the shortest job (${shortestJob} min), so no day could take a booking.`,
    });
  }

  // GST on with no number would print "Tax invoice" with a blank GST line.
  if (p.gstRegistered && !identity.gstNumber.trim()) {
    issues.push({
      level: "block",
      message:
        "GST registered is on but no GST number is set - invoices would print 'Tax invoice' with no number. Add the GST number first.",
    });
  }

  // Longest duration that fits nowhere is silently unbookable.
  const longest = Math.max(a.durations.short, a.durations.long);
  const fitsAnywhere = [0, 1, 2, 3, 4, 5, 6].some((day) => {
    const d = a.schedule[day];
    if (!d?.enabled) return false;
    const segments = d.break ? [d.break.start - d.open, d.close - d.break.end] : [d.close - d.open];
    return Math.max(...segments) * 60 >= longest + a.bookingBufferAfterMin;
  });
  if (!fitsAnywhere) {
    issues.push({
      level: "warn",
      message: `The longest job (${longest} min) doesn't fit in any open day, so that duration can never be booked.`,
    });
  }

  // Reschedule cutoff outliving the free-cancel window is allowed but odd.
  if (p.reschedule.cutoffHours > p.cancellation.freeNoticeHours) {
    issues.push({
      level: "warn",
      message:
        "Reschedule cutoff is later than the free-cancellation window, so customers can cancel free but not reschedule. Double-check that's intended.",
    });
  }

  // The reminder window runs from (free-notice + 1h) up to the lead time; if the
  // lead time isn't beyond that lower bound, no reminder could ever send.
  if (comms.notifyReminder && comms.reminderLeadHours <= p.cancellation.freeNoticeHours + 1) {
    issues.push({
      level: "block",
      message: `Reminder lead time (${comms.reminderLeadHours}h) must be more than the free-cancellation window + 1h (${p.cancellation.freeNoticeHours + 1}h), otherwise reminders would never send.`,
    });
  }

  return issues;
}
