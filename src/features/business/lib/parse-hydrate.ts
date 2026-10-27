// src/features/business/lib/parse-hydrate.ts
// Pure helpers turning a parse-job request/response into billable job pieces, shared by the
// calculator and the draft-invoice editor so a description bills the same either way.

import {
  billableMins,
  calcJobTotal,
  collapseToWindow,
  composeDescription,
  enforceMinBillable,
  jobToLineItems,
  promoRateNote,
  TASK_TIMING_FALLBACK,
  timeDiffMins,
  type JobPromo,
  type LabourSurcharge,
  type TaskTimingConfig,
} from "@/features/business/lib/business";
import { storeRunEntry } from "@/features/business/lib/calculator-helpers";
import { calcTravelCharge } from "@/features/business/lib/pricing-policy";
import {
  extractRanges,
  statedRangeWeekdays,
  weekdayOfDateKey,
} from "@/features/business/lib/time-parse";
import type {
  EventPrefillSlot,
  JobCalculation,
  LineItem,
  ParsedRange,
  ParseJobResponse,
  RateConfig,
  TaskLine,
  TravelEntry,
} from "@/features/business/types/business";
import { roundCents } from "@/shared/lib/money";
import { timeParts } from "@/shared/lib/timezone-utils";

/** A known job window: a booked event's slot, or a range typed on the Time card. */
export type WindowSlot = Pick<EventPrefillSlot, "date" | "startTime" | "endTime">;

/**
 * Whether the window survives the description's own times. Times on no named day or the
 * window's weekday replace it; times all on other named days are a later visit billed on top.
 * @param aiInput - The operator's description.
 * @param slots - Known windows.
 * @returns True when the window should still be sent.
 */
function windowSurvivesStatedTimes(aiInput: string, slots: WindowSlot[]): boolean {
  const stated = statedRangeWeekdays(aiInput);
  if (stated.length === 0) return true;
  const windowDays = new Set(slots.map((s) => weekdayOfDateKey(s.date)));
  return stated.every((d) => d !== null && !windowDays.has(d));
}

/**
 * Builds the parse-job `input`, prepending known windows as "HH:MM-HH:MM" lines (under a date
 * line per day, so days don't merge) when {@link windowSurvivesStatedTimes}. Slots the text
 * already states are skipped so they don't bill twice; only stated ranges count, not "@ 10:30".
 * @param aiInput - The operator's description.
 * @param slots - Known windows (booked slots or typed times), date-ordered; empty when none.
 * @returns The input string to send.
 */
export function buildParseInput(aiInput: string, slots: WindowSlot[]): string {
  if (!windowSurvivesStatedTimes(aiInput, slots)) return aiInput;
  const restated = new Set(extractRanges(aiInput).map((r) => `${r.startTime}-${r.endTime}`));
  const windowLines: string[] = [];
  let lastSlotDate: string | null = null;
  for (const slot of slots) {
    if (!slot.startTime || !slot.endTime) continue;
    if (restated.has(`${slot.startTime}-${slot.endTime}`)) continue;
    if (slot.date !== lastSlotDate) {
      windowLines.push(slot.date);
      lastSlotDate = slot.date;
    }
    windowLines.push(`${slot.startTime}-${slot.endTime}`);
  }
  if (windowLines.length === 0) return aiInput;
  return `${windowLines.join("\n")}\n${aiInput}`;
}

/**
 * Adds minutes to an HH:MM time, clamped within the same day (00:00-23:59).
 * @param t - Base time.
 * @param mins - Minutes to add (may be negative).
 * @returns The shifted HH:MM time.
 */
export function addMinsToTime(t: string, mins: number): string {
  const [h, m] = timeParts(t);
  const total = Math.max(0, Math.min(24 * 60 - 1, h * 60 + m + Math.round(mins)));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Time window a parse bills against. */
export interface ParsedWindow {
  /** Slots to show, or null when the parse leaves the current slots alone. */
  timeRanges: ParsedRange[] | null;
  /** Whether the slots are times the input stated, not built from a duration or open start. */
  stated: boolean;
  /** Billable window in minutes: slot time plus out-of-session follow-up. */
  windowMins: number;
  /** Out-of-session minutes (a call after the visit). */
  followUpMins: number;
}

/**
 * Parsed ranges left once every slot is matched off (a later visit beside a merged booking).
 * Empty unless every slot comes back, since a missing slot means the window was never sent.
 * @param ranges - The parse reply's ranges.
 * @param slots - The merged booking's slots.
 * @returns The ranges beyond the slots.
 */
function rangesBeyondSlots(
  ranges: readonly ParsedRange[],
  slots: readonly WindowSlot[],
): ParsedRange[] {
  const left = [...ranges];
  for (const slot of slots) {
    const i = left.findIndex((r) => r.startTime === slot.startTime && r.endTime === slot.endTime);
    if (i === -1) return [];
    left.splice(i, 1);
  }
  return left;
}

/**
 * Works out the billable window: ranges, then start/end, then a duration anchored to the slot
 * (or `now`). A merged job keeps its exact calendar slots plus any later visit.
 * @param result - The parse response.
 * @param slots - Known windows (booked slots or typed times); empty when none.
 * @param now - Current NZ wall-clock HH:MM, the anchor when no booked slot exists.
 * @param merged - Whether the slots are a merged booking to keep as-is (default: 2+ slots).
 * @returns The window, follow-up minutes, and any slots to show.
 */
export function parsedWindow(
  result: ParseJobResponse,
  slots: WindowSlot[],
  now: string,
  merged: boolean = slots.length > 1,
): ParsedWindow {
  const followUpMins = Math.max(0, Math.round(result.outOfSessionMins ?? 0));
  // A reply missing the field (or carrying a non-number) reads as no duration, not NaN.
  const durationMins =
    typeof result.durationMins === "number" && Number.isFinite(result.durationMins)
      ? result.durationMins
      : null;
  const anchor = slots[0] ?? null;
  let timeRanges: ParsedRange[] | null = null;
  let stated = false;
  let windowMins = followUpMins;
  // An open start closes at the booked end, else now; never rolled overnight into an 18h job.
  const openEnd = anchor?.endTime ?? now;
  const openSpan =
    result.startTime && !result.endTime ? clockMins(openEnd) - clockMins(result.startTime) : 0;
  if (merged) {
    windowMins += slots.reduce((s, r) => s + timeDiffMins(r.startTime, r.endTime), 0);
    // Not marked stated, so the next parse resends the slots and rereads the later visit.
    const later = rangesBeyondSlots(
      (result.ranges ?? []).map((r) => ({ startTime: r.startTime, endTime: r.endTime })),
      slots,
    );
    if (later.length > 0) {
      timeRanges = [
        ...slots.map((s) => ({ startTime: s.startTime, endTime: s.endTime })),
        ...later,
      ];
      windowMins += later.reduce((s, r) => s + timeDiffMins(r.startTime, r.endTime), 0);
    }
  } else if (result.ranges && result.ranges.length > 0) {
    timeRanges = result.ranges.map((r) => ({ startTime: r.startTime, endTime: r.endTime }));
    stated = true;
    windowMins += result.ranges.reduce((s, r) => s + timeDiffMins(r.startTime, r.endTime), 0);
  } else if (result.startTime && result.endTime) {
    timeRanges = [{ startTime: result.startTime, endTime: result.endTime }];
    stated = true;
    windowMins += timeDiffMins(result.startTime, result.endTime);
  } else if (result.startTime && openSpan > 0) {
    timeRanges = [{ startTime: result.startTime, endTime: openEnd }];
    windowMins += openSpan;
  } else if (durationMins !== null) {
    // Duration only (or an open start ending before it starts): anchor to the slot, else now.
    const inSessionMins = Math.max(0, durationMins - followUpMins);
    const startTime = anchor ? anchor.startTime : addMinsToTime(now, -inSessionMins);
    const endTime = anchor ? addMinsToTime(anchor.startTime, inSessionMins) : now;
    timeRanges = [{ startTime, endTime }];
    windowMins = followUpMins + inSessionMins;
  }
  // durationMins is already clamped (free work removed, day ceiling applied); don't regrow it.
  if (!merged && durationMins !== null && durationMins > 0 && durationMins < windowMins) {
    windowMins = durationMins;
  }
  return { timeRanges, stated, windowMins, followUpMins };
}

/**
 * Minutes since midnight for an HH:MM time, NaN-safe (a bad time reads as 0).
 * @param t - HH:MM time.
 * @returns Minutes since midnight.
 */
function clockMins(t: string): number {
  const [h, m] = timeParts(t);
  return Number.isNaN(h) || Number.isNaN(m) ? 0 : h * 60 + m;
}

/**
 * Hydrates the parsed task rows into calculator task lines (before any window fit).
 * @param result - The parse response.
 * @returns One task line per parsed task.
 */
export function hydrateParsedTasks(result: ParseJobResponse): TaskLine[] {
  // A reply missing its task list hydrates to no tasks rather than throwing mid-apply.
  return (Array.isArray(result.tasks) ? result.tasks : []).map((t) => {
    const device = t.device ?? null;
    const action = t.action ?? null;
    const details = t.details?.trim() ? t.details.trim() : null;
    const description = composeDescription(device, action, details) || t.description || "";
    // Same rule as isHourlyTask; a stray rateConfigId beside a baseRateId is dropped.
    const isHourly = t.baseRateId != null || t.rateConfigId == null;
    // Bill hourly tasks in grid minutes with qty unrounded so lines sum to the session.
    const minutes = isHourly ? (t.minutes ?? Math.round(t.qty * 60)) : undefined;
    const qty = minutes != null ? minutes / 60 : Math.round(t.qty * 100) / 100;
    return {
      rateConfigId: isHourly ? null : (t.rateConfigId ?? null),
      baseRateId: t.baseRateId ?? null,
      modifierIds: t.modifierIds ?? [],
      description,
      qty,
      ...(minutes != null && { minutes }),
      unitPrice: t.unitPrice,
      lineTotal: roundCents(qty * t.unitPrice),
      device,
      action,
      details,
      isShort: t.isShort ?? false,
      isExplicit: t.isExplicit ?? false,
      // Per-line halving: an AI-flagged unresolved task bills half its labour.
      unsuccessful: t.unsuccessful ?? false,
    };
  });
}

/** Tasks fitted to a window, plus what the fit changed (for an operator toast). */
export interface FittedTasks {
  tasks: TaskLine[];
  rescaled: boolean;
  dropped: number;
}

/**
 * Rebalances tasks to fit the grid-snapped window, then floors the job at the minimum. Snap
 * first as clampBillableMins does, or a 79-min 30/30/20 split would bill 29/30/20.
 * @param tasks - Hydrated task lines.
 * @param windowMins - Billable window from {@link parsedWindow}, or the Time card's total.
 * @param timing - Live task-timing settings.
 * @param minBillableMins - Live minimum billable minutes.
 * @returns The fitted tasks and what changed.
 */
export function fitTasksToWindow(
  tasks: TaskLine[],
  windowMins: number,
  timing: TaskTimingConfig | undefined,
  minBillableMins: number,
): FittedTasks {
  const gridMins = billableMins(windowMins, (timing ?? TASK_TIMING_FALLBACK).snapMins);
  const collapsed = collapseToWindow(tasks, gridMins, timing);
  return {
    tasks: enforceMinBillable(collapsed.tasks, minBillableMins),
    rescaled: collapsed.rescaled,
    dropped: collapsed.dropped,
  };
}

/**
 * Operator toast text for a window fit, or null when nothing was rebalanced.
 * @param fit - Result of {@link fitTasksToWindow}.
 * @param windowMins - The window the tasks were fitted to.
 * @returns The message, or null.
 */
export function describeFit(fit: FittedTasks, windowMins: number): string | null {
  if (!fit.rescaled && fit.dropped === 0) return null;
  const dropped =
    fit.dropped > 0 ? ` (dropped ${fit.dropped} tiny task${fit.dropped === 1 ? "" : "s"})` : "";
  return `Rebalanced tasks${dropped} to fit the ${windowMins}-min window.`;
}

/**
 * The auto travel entry for a parse with drive time, or null when none. {@link calcTravelCharge}
 * applies the minimum charge.
 * @param result - The parse response.
 * @param travelRatePerHour - Live travel rate.
 * @param minTravelCharge - Live minimum travel charge.
 * @returns The auto entry, or null.
 */
export function parsedAutoTravel(
  result: ParseJobResponse,
  travelRatePerHour: number,
  minTravelCharge: number,
): TravelEntry | null {
  if (!result.travel || result.travel.durationMins <= 0) return null;
  const label = result.destination?.trim() || `${result.travel.durationMins} min drive`;
  return {
    label,
    cost: calcTravelCharge(
      result.travel.durationMins,
      result.travel.durationMinsBack,
      travelRatePerHour,
      minTravelCharge,
    ),
    isAuto: true,
    destination: result.destination ?? label,
    durationMinsOneWay: result.travel.durationMins,
    durationMinsBack: result.travel.durationMinsBack,
    distanceKmOneWay: result.travel.distanceKmOneWay,
  };
}

/**
 * Parking and tolls from a parse at stated cost; isParsedCost lets a reparse replace them.
 * @param result - The parse response.
 * @returns One travel entry per stated cost.
 */
export function parsedCostEntries(result: ParseJobResponse): TravelEntry[] {
  return (result.travelCosts ?? []).map((c) => ({
    label: c.label,
    cost: roundCents(c.cost),
    isParsedCost: true,
  }));
}

/**
 * Store runs from a parse at the travel rate, no minimum; isParsedCost lets a reparse replace them.
 * @param result - The parse response.
 * @param travelRatePerHour - Live travel rate.
 * @returns One store-run entry per timed run.
 */
export function parsedStoreRunEntries(
  result: ParseJobResponse,
  travelRatePerHour: number,
): TravelEntry[] {
  return (result.storeRunTravel ?? []).map((r) => ({
    ...storeRunEntry(
      r.store,
      r.durationMinsThere,
      r.durationMinsBack,
      r.distanceKm,
      travelRatePerHour,
    ),
    isParsedCost: true,
  }));
}

/** Pricing inputs {@link parsedJobToLineItems} needs. */
export interface ParsedJobPricing {
  taskTiming?: TaskTimingConfig;
  minBillableMins: number;
  travelRatePerHour: number;
  minTravelCharge: number;
  /** Labour surcharge for the job date (public holiday or weekend), or null when none. */
  surcharge: LabourSurcharge | null;
  /** Share of an unsuccessful line still charged (0.5 = half price). */
  unsuccessfulFactor?: number;
  /** RateConfig id of the "Business" modifier, whose labour a promo skips. */
  businessModifierId?: string | null;
  /** The undiscounted Standard $/hr a flat promo cuts from. */
  standardRate?: number | null;
  /** Live rate list, for a flat promo's per-line floor. */
  rates?: RateConfig[];
  /** The invoice's Gold Card share off labour (0.1 = 10%), or 0/absent when it has none. */
  goldCardPercent?: number;
}

/** The invoice's current travel, for {@link parsedJobToLineItems} to keep when it should. */
export interface ExistingInvoiceTravel {
  /** The invoice's "Round-trip travel" line, or null when it has none. */
  line: LineItem | null;
  /** The booked job's address; a re-parse to the same place keeps the measured drive. */
  destination: string | null;
}

/**
 * The drive part of an existing travel line, re-priced from its drive minutes alone (the
 * new parse re-adds parking and tolls). A line with no minutes has no drive to keep.
 * @param line - The invoice's travel line.
 * @param pricing - Live pricing inputs.
 * @returns The kept drive as a travel entry, or null when the line records no drive.
 */
function keptTravelEntry(line: LineItem, pricing: ParsedJobPricing): TravelEntry | null {
  // "(N min drive)" is the round-trip total, so it rides entirely on the outbound leg.
  const driveMins = Number(/\((\d+) min drive\)/.exec(line.description)?.[1] ?? 0);
  if (driveMins <= 0) return null;
  return {
    label: line.description,
    cost: calcTravelCharge(driveMins, 0, pricing.travelRatePerHour, pricing.minTravelCharge),
    isAuto: true,
    durationMinsOneWay: driveMins,
    durationMinsBack: 0,
  };
}

/**
 * Normalises an address for a same-place comparison.
 * @param address - Address text, or null.
 * @returns Trimmed lowercase text, or "" when missing.
 */
function sameAddressKey(address: string | null | undefined): string {
  return address?.trim().toLowerCase() ?? "";
}

/**
 * Turns a parse straight into invoice line items for editing an existing invoice. A booked
 * job keeps its measured drive when the text skips the trip or parses to the booked address
 * (Google's quote drifts). Discounts come from {@link calcJobTotal}, as in the calculator.
 * @param result - The parse response.
 * @param slots - Booked event slots; empty for an unbooked job.
 * @param now - Current NZ wall-clock HH:MM.
 * @param pricing - Live pricing inputs.
 * @param existing - The invoice's current travel line and booked address.
 * @param promo - The invoice's promo terms, or null when it has none.
 * @returns Line items, the window fit, the promo (with its rate note), Gold Card and
 * unsuccessful-work discounts.
 */
export function parsedJobToLineItems(
  result: ParseJobResponse,
  slots: EventPrefillSlot[],
  now: string,
  pricing: ParsedJobPricing,
  existing: ExistingInvoiceTravel,
  promo: JobPromo | null = null,
): {
  lineItems: LineItem[];
  fit: FittedTasks;
  windowMins: number;
  promoDiscount: number;
  promoNote: string | null;
  goldCardDiscount: number;
  unsuccessfulDiscount: number;
  unsuccessfulNote: string | null;
} {
  const { windowMins } = parsedWindow(result, slots, now);
  const fit = fitTasksToWindow(
    hydrateParsedTasks(result),
    windowMins,
    pricing.taskTiming,
    pricing.minBillableMins,
  );
  const auto = parsedAutoTravel(result, pricing.travelRatePerHour, pricing.minTravelCharge);
  const travelEntries: TravelEntry[] = [
    ...parsedCostEntries(result),
    ...parsedStoreRunEntries(result, pricing.travelRatePerHour),
  ];
  const booked = slots.length > 0 && !result.noTravelCharge && existing.line !== null;
  const sameBookedPlace =
    auto !== null &&
    sameAddressKey(existing.destination) !== "" &&
    sameAddressKey(auto.destination) === sameAddressKey(existing.destination);
  const kept =
    existing.line && booked && (auto === null || sameBookedPlace)
      ? keptTravelEntry(existing.line, pricing)
      : null;
  if (kept) travelEntries.unshift(kept);
  else if (auto) travelEntries.unshift(auto);
  const job: JobCalculation = {
    durationMins: windowMins,
    tasks: fit.tasks,
    parts: result.parts.map((p) => ({ description: p.description, cost: p.cost })),
    travelEntries,
    notes: result.notes,
    clientName: "",
    clientEmail: "",
  };
  const lineItems = jobToLineItems(
    job,
    pricing.surcharge,
    pricing.minTravelCharge,
    pricing.minBillableMins,
  );
  const { promoDiscount, promoRate, goldCardDiscount, unsuccessfulDiscount, unsuccessfulNote } =
    calcJobTotal(job, promo, {
      // Only the discounts are read, and none depends on GST.
      gstRegistered: false,
      minTravelCharge: pricing.minTravelCharge,
      minBillableMins: pricing.minBillableMins,
      surchargeUplift: pricing.surcharge?.uplift ?? 0,
      unsuccessfulFactor: pricing.unsuccessfulFactor,
      businessModifierId: pricing.businessModifierId,
      standardRate: pricing.standardRate,
      rates: pricing.rates,
      goldCardPercent: pricing.goldCardPercent,
    });
  return {
    lineItems,
    fit,
    windowMins,
    promoDiscount,
    promoNote: promoRateNote(promoRate),
    goldCardDiscount,
    unsuccessfulDiscount,
    unsuccessfulNote,
  };
}
