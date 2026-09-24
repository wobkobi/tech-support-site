// Pure helpers that turn a parse-job request/response into billable job pieces. Shared by
// the calculator and the draft-invoice editor so a description bills the same either way.

import {
  collapseToWindow,
  composeDescription,
  enforceMinBillable,
  jobToLineItems,
  timeDiffMins,
  type TaskTimingConfig,
} from "@/features/business/lib/business";
import { calcTravelCharge } from "@/features/business/lib/pricing-policy";
import { extractRanges } from "@/features/business/lib/time-parse";
import type {
  EventPrefillSlot,
  LineItem,
  ParsedRange,
  ParseJobResponse,
  TaskLine,
  TravelEntry,
} from "@/features/business/types/business";
import { timeParts } from "@/shared/lib/timezone-utils";

/**
 * Builds the parse-job `input` for a description. For a booked job, prepends the booking's
 * window as digit-led "HH:MM-HH:MM" lines so the parser bills the real session length
 * instead of falling back to the minimum - only when the description states no ranges of
 * its own, so operator times win. A merged job gets one line per event under a date line
 * per day; extractRanges sums them server-side excluding the gaps.
 *
 * A date line goes in whenever the day changes so the parser buckets each day on its own.
 * Without it a second day's window sitting inside the first day's hours merges away and
 * those minutes never bill. Only actual RANGES in the description count as stated times:
 * an incidental "drove to PB Tech @ 10:30 am" must not drop the booked window.
 * @param aiInput - The operator's description.
 * @param slots - Booked event slots, date-ordered; empty for an unbooked job.
 * @returns The input string to send.
 */
export function buildParseInput(aiInput: string, slots: EventPrefillSlot[]): string {
  const windowLines: string[] = [];
  let lastSlotDate: string | null = null;
  for (const slot of slots) {
    if (!slot.startTime || !slot.endTime) continue;
    if (slot.date !== lastSlotDate) {
      windowLines.push(slot.date);
      lastSlotDate = slot.date;
    }
    windowLines.push(`${slot.startTime}-${slot.endTime}`);
  }
  if (windowLines.length === 0 || extractRanges(aiInput).length > 0) return aiInput;
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
  /** Billable window in minutes: slot time plus out-of-session follow-up. */
  windowMins: number;
  /** Out-of-session minutes (a call after the visit). */
  followUpMins: number;
}

/**
 * Works out the billable window from a parse. Prefers the per-range list, then a
 * start/end pair, then a bare duration anchored to the booked slot (or to `now`).
 * A merged job keeps its slots - they come from several corrected calendar windows,
 * exact and not reconstructable from free text.
 * @param result - The parse response.
 * @param slots - Booked event slots; empty for an unbooked job.
 * @param now - Current NZ wall-clock HH:MM, the anchor when no booked slot exists.
 * @returns The window, follow-up minutes, and any slots to show.
 */
export function parsedWindow(
  result: ParseJobResponse,
  slots: EventPrefillSlot[],
  now: string,
): ParsedWindow {
  const followUpMins = Math.max(0, Math.round(result.outOfSessionMins ?? 0));
  const anchor = slots[0] ?? null;
  let timeRanges: ParsedRange[] | null = null;
  let windowMins = followUpMins;
  const merged = slots.length > 1;
  if (merged) {
    windowMins += slots.reduce((s, r) => s + timeDiffMins(r.startTime, r.endTime), 0);
  } else if (result.ranges && result.ranges.length > 0) {
    timeRanges = result.ranges.map((r) => ({ startTime: r.startTime, endTime: r.endTime }));
    windowMins += result.ranges.reduce((s, r) => s + timeDiffMins(r.startTime, r.endTime), 0);
  } else if (result.startTime && result.endTime) {
    timeRanges = [{ startTime: result.startTime, endTime: result.endTime }];
    windowMins += timeDiffMins(result.startTime, result.endTime);
  } else if (result.startTime) {
    // Start stated but no end: close at the booked event's end, else at now. Anchoring a
    // past job to now would end it at today's wall clock instead of inside its window.
    const end = anchor?.endTime ?? now;
    timeRanges = [{ startTime: result.startTime, endTime: end }];
    windowMins += timeDiffMins(result.startTime, end);
  } else if (result.durationMins !== null) {
    // Duration only ("was there about 2 hours"): anchor to the booked start, else end now.
    const inSessionMins = Math.max(0, result.durationMins - followUpMins);
    const startTime = anchor ? anchor.startTime : addMinsToTime(now, -inSessionMins);
    const endTime = anchor ? addMinsToTime(anchor.startTime, inSessionMins) : now;
    timeRanges = [{ startTime, endTime }];
    windowMins = followUpMins + inSessionMins;
  }
  // The server's durationMins is the billable figure after its clamps: free work the
  // description states is already subtracted, and the longest-billable-day ceiling
  // applied. Fitting the tasks to the raw range sum would grow them back over both.
  if (
    !merged &&
    result.durationMins !== null &&
    result.durationMins > 0 &&
    result.durationMins < windowMins
  ) {
    windowMins = result.durationMins;
  }
  return { timeRanges, windowMins, followUpMins };
}

/**
 * Hydrates the parsed task rows into calculator task lines (before any window fit).
 * @param result - The parse response.
 * @returns One task line per parsed task.
 */
export function hydrateParsedTasks(result: ParseJobResponse): TaskLine[] {
  return result.tasks.map((t) => {
    const device = t.device ?? null;
    const action = t.action ?? null;
    const details = t.details?.trim() ? t.details.trim() : null;
    // The server already composes the description; composing locally keeps it right if
    // an older route shape sneaks through.
    const description = composeDescription(device, action, details) || t.description || "";
    // A baseRateId marks an hourly task, so a stray AI rateConfigId is dropped to keep
    // the promo maths classifying it correctly.
    const isHourly = t.baseRateId != null;
    // Hourly tasks arrive snapped to the billing grid in whole minutes; carry those as
    // the billed unit with qty unrounded so line quantities sum to the session.
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
      lineTotal: Math.round(qty * t.unitPrice * 100) / 100,
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
 * Rebalances tasks proportionally to fit the window - over-long tasks absorb more of the
 * correction, tasks scaling below the minimum drop - then floors the whole job so a
 * sub-minimum one bills at the minimum.
 * @param tasks - Hydrated task lines.
 * @param windowMins - Billable window from {@link parsedWindow}.
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
  const collapsed = collapseToWindow(tasks, windowMins, timing);
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
 * The auto travel entry for a parse with drive time, or null when there was none (remote,
 * or geocoded to origin). {@link calcTravelCharge} applies the minimum, so a 1-min drive
 * still bills the published floor.
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
 * Out-of-pocket disbursements (parking, tolls) from a parse, passed through at the stated
 * cost. isParsedCost lets a reparse replace them while a manual re-lookup leaves them.
 * @param result - The parse response.
 * @returns One travel entry per stated cost.
 */
export function parsedCostEntries(result: ParseJobResponse): TravelEntry[] {
  return (result.travelCosts ?? []).map((c) => ({
    label: c.label,
    cost: Math.round(c.cost * 100) / 100,
    isParsedCost: true,
  }));
}

/** Pricing inputs {@link parsedJobToLineItems} needs. */
export interface ParsedJobPricing {
  taskTiming?: TaskTimingConfig;
  minBillableMins: number;
  travelRatePerHour: number;
  minTravelCharge: number;
  /** Public-holiday labour uplift fraction for the job date (0 when none). */
  holidayUplift: number;
}

/** The invoice's current travel, for {@link parsedJobToLineItems} to keep when it should. */
export interface ExistingInvoiceTravel {
  /** The invoice's "Round-trip travel" line, or null when it has none. */
  line: LineItem | null;
  /** The booked job's address; a re-parse to the same place keeps the measured drive. */
  destination: string | null;
}

/**
 * The drive part of an existing travel line, as an auto entry. The line total also holds
 * any parking or tolls from the last parse, which the new parse re-adds, so a line that
 * records its drive minutes is re-priced from those minutes alone. One without minutes
 * keeps its total, since the drive can't be separated from the rest.
 * @param line - The invoice's travel line.
 * @param pricing - Live pricing inputs.
 * @returns The kept drive as a travel entry.
 */
function keptTravelEntry(line: LineItem, pricing: ParsedJobPricing): TravelEntry {
  // "(N min drive)" is the round-trip total, so it rides entirely on the outbound leg.
  const driveMins = Number(/\((\d+) min drive\)/.exec(line.description)?.[1] ?? 0);
  if (driveMins <= 0) return { label: line.description, cost: line.lineTotal, isAuto: true };
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
 * Turns a parse straight into invoice line items, for editing an existing invoice where
 * there is no calculator state to hydrate.
 *
 * A booked job keeps the invoice's measured drive in two cases, as the calculator does:
 * the description never mentions the trip (silence is not evidence it didn't happen), or
 * it parses to the booked address again (Google's live quote drifts between calls, so a
 * re-parse must not silently move the price). noTravelCharge still drops it.
 * @param result - The parse response.
 * @param slots - Booked event slots; empty for an unbooked job.
 * @param now - Current NZ wall-clock HH:MM.
 * @param pricing - Live pricing inputs.
 * @param existing - The invoice's current travel line and booked address.
 * @returns Line items plus the window fit (for a rebalance toast).
 */
export function parsedJobToLineItems(
  result: ParseJobResponse,
  slots: EventPrefillSlot[],
  now: string,
  pricing: ParsedJobPricing,
  existing: ExistingInvoiceTravel,
): { lineItems: LineItem[]; fit: FittedTasks; windowMins: number } {
  const { windowMins } = parsedWindow(result, slots, now);
  const fit = fitTasksToWindow(
    hydrateParsedTasks(result),
    windowMins,
    pricing.taskTiming,
    pricing.minBillableMins,
  );
  const auto = parsedAutoTravel(result, pricing.travelRatePerHour, pricing.minTravelCharge);
  const travelEntries: TravelEntry[] = parsedCostEntries(result);
  const booked = slots.length > 0 && !result.noTravelCharge && existing.line !== null;
  const sameBookedPlace =
    auto !== null &&
    sameAddressKey(existing.destination) !== "" &&
    sameAddressKey(auto.destination) === sameAddressKey(existing.destination);
  if (existing.line && booked && (auto === null || sameBookedPlace)) {
    travelEntries.unshift(keptTravelEntry(existing.line, pricing));
  } else if (auto) {
    travelEntries.unshift(auto);
  }
  const lineItems = jobToLineItems(
    {
      durationMins: windowMins,
      tasks: fit.tasks,
      parts: result.parts.map((p) => ({ description: p.description, cost: p.cost })),
      travelEntries,
      notes: result.notes,
      clientName: "",
      clientEmail: "",
    },
    pricing.holidayUplift,
    pricing.minTravelCharge,
    pricing.minBillableMins,
  );
  return { lineItems, fit, windowMins };
}
