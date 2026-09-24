// src/features/business/lib/calculator-helpers.ts
// Pure helpers behind the job calculator: date/time arithmetic, task-line edits that
// recompute prices from the rate table, and the travel-time lookup for the auto entry.

import { effectiveHourlyRate, isChannelModifier, todayISO } from "@/features/business/lib/business";
import { calcTravelCharge } from "@/features/business/lib/pricing-policy";
import type { RateConfig, TaskLine, TravelEntry } from "@/features/business/types/business";
import { addDaysToDateKey, nextNzWallClockOnWeekday, timeParts } from "@/shared/lib/timezone-utils";

/**
 * Returns the NZ calendar date (YYYY-MM-DD) n days from today.
 * @param n - Number of days to add to today.
 * @returns ISO date string (YYYY-MM-DD).
 */
export function addDaysISO(n: number): string {
  return addDaysToDateKey(todayISO(), n);
}

/**
 * Adds one hour to a time string, wrapping around at midnight.
 * @param t - A time string in HH:MM format.
 * @returns A new time string one hour later, in HH:MM format.
 */
export function addHour(t: string): string {
  const [h, m] = timeParts(t);
  return `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Builds a UTC ISO timestamp for an HH:MM NZ wall-clock start on the next
 * occurrence of the job date's WEEKDAY (today counts while the time is still
 * ahead). Google only quotes traffic for future departures, so a past job is
 * priced at the same weekday + time as a proxy for that day's actual traffic.
 * Returns null when the input isn't a valid HH:MM string.
 * @param hhmm - Start time in HH:MM (24h) NZ wall-clock.
 * @param anchorDate - NZ-local YYYY-MM-DD whose weekday to match (the job date); malformed values fall back to today.
 * @returns ISO 8601 UTC timestamp, or null.
 */
function jobStartIsoFromTime(hhmm: string, anchorDate?: string): string | null {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = timeParts(hhmm);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return nextNzWallClockOnWeekday(h, m, anchorDate).toISOString();
}

/**
 * Builds an empty hourly task line seeded with the default base rate (e.g.
 * Standard $65/hr) and no modifiers. Flat-rate rows (Travel etc.) come from
 * AI parse or address lookup.
 * @param rates - The list of available rate configurations.
 * @returns A default hourly TaskLine.
 */
export function emptyTask(rates: RateConfig[]): TaskLine {
  const defaultBase =
    rates.find((r) => r.ratePerHour !== null && r.isDefault) ??
    rates.find((r) => r.ratePerHour !== null) ??
    null;
  const price = defaultBase?.ratePerHour ?? 0;
  return {
    rateConfigId: null,
    baseRateId: defaultBase?.id ?? null,
    modifierIds: [],
    description: "",
    qty: 1,
    unitPrice: price,
    lineTotal: price,
    device: null,
    action: null,
    details: null,
  };
}

/**
 * Updates a single field on a task line, recalculating the line total when quantity or unit price
 * changes, and auto-filling description and price when a rate config is selected.
 * @param prev - Current task lines.
 * @param idx - The zero-based index of the task in the tasks array.
 * @param field - The field on the TaskLine to update.
 * @param val - The new value for the field.
 * @param rates - Rate configs, used to resolve a picked rateConfigId.
 * @returns The next task lines, or `prev` unchanged when idx is out of range.
 */
export function updateTaskField(
  prev: TaskLine[],
  idx: number,
  field: keyof TaskLine,
  val: string | number | null,
  rates: RateConfig[],
): TaskLine[] {
  const t = [...prev];
  const existing = t[idx];
  if (!existing) return prev;
  const item = { ...existing, [field]: val };
  // Minutes are the billed unit on hourly rows, so a hand-edited qty must rewrite them
  // or the stale value keeps winning downstream. The row edits hrs + mins, so the
  // incoming qty is already whole minutes: snap it, and carry qty unrounded.
  if (field === "qty") {
    const mins = Math.round(Number(val) * 60);
    if (item.baseRateId != null) {
      item.minutes = mins;
      item.qty = mins / 60;
    } else {
      // Flat rows (Travel etc.) count units, not time.
      item.minutes = undefined;
      item.qty = Math.round(Number(val) * 100) / 100;
    }
  }
  if (field === "rateConfigId") {
    const rate = rates.find((r) => r.id === val);
    if (rate) {
      item.description = rate.label;
      item.unitPrice = rate.flatRate ?? rate.ratePerHour ?? 0;
      item.lineTotal = Math.round(item.qty * item.unitPrice * 100) / 100;
    }
  }
  if (field === "qty" || field === "unitPrice") {
    item.lineTotal = Math.round(Number(item.qty) * Number(item.unitPrice) * 100) / 100;
  }
  t[idx] = item;
  return t;
}

/**
 * Toggles a modifier rate on a task and recomputes the unit price + line
 * total from the resulting base + modifiers combo.
 * @param prev - Current task lines.
 * @param idx - Task index.
 * @param modifierId - Modifier rate ID being toggled on/off.
 * @param rates - Rate configs the effective rate is computed from.
 * @returns The next task lines, or `prev` unchanged when idx is out of range.
 */
export function toggleTaskModifierLine(
  prev: TaskLine[],
  idx: number,
  modifierId: string,
  rates: RateConfig[],
): TaskLine[] {
  const arr = [...prev];
  const target = arr[idx];
  if (!target) return prev;
  const current = target.modifierIds ?? [];
  const picked = rates.find((r) => r.id === modifierId);
  let next: string[];
  if (current.includes(modifierId)) {
    next = current.filter((m) => m !== modifierId);
  } else if (picked && isChannelModifier(picked)) {
    // One task, one delivery channel: picking a second SWAPS rather than stacking,
    // which would compound both discounts into a rate the invoice never charges.
    const channelIds = new Set(rates.filter(isChannelModifier).map((r) => r.id));
    next = [...current.filter((m) => !channelIds.has(m)), modifierId];
  } else {
    next = [...current, modifierId];
  }
  const newPrice = effectiveHourlyRate(rates, target.baseRateId, next);
  arr[idx] = {
    ...target,
    modifierIds: next,
    unitPrice: newPrice,
    lineTotal: Math.round(target.qty * newPrice * 100) / 100,
  };
  return arr;
}

/**
 * Sets a task's base hourly rate and recomputes its unit price + line total.
 * @param prev - Current task lines.
 * @param idx - Task index.
 * @param baseId - New base rate ID, or null to clear.
 * @param rates - Rate configs the effective rate is computed from.
 * @returns The next task lines, or `prev` unchanged when idx is out of range.
 */
export function setTaskBaseLine(
  prev: TaskLine[],
  idx: number,
  baseId: string | null,
  rates: RateConfig[],
): TaskLine[] {
  const arr = [...prev];
  const target = arr[idx];
  if (!target) return prev;
  const newPrice = effectiveHourlyRate(rates, baseId, target.modifierIds);
  arr[idx] = {
    ...target,
    baseRateId: baseId,
    unitPrice: newPrice,
    lineTotal: Math.round(target.qty * newPrice * 100) / 100,
  };
  return arr;
}

/** Inputs for {@link lookupAutoTravel}. */
interface AutoTravelLookup {
  /** Job address as typed or picked. */
  jobAddress: string;
  /** Earliest slot start (HH:MM), the outbound departure. */
  aggregateStart: string;
  /** Latest slot end (HH:MM), the return departure. */
  aggregateEnd: string;
  /** Job date (YYYY-MM-DD) whose weekday traffic both legs are quoted at. */
  jobDate: string;
  /** Billable window, the fallback gap between the two departures. */
  durationMins: number;
  /** Live travel rate from settings. */
  travelRatePerHour: number;
  /** Live travel minimum from settings. */
  minTravelCharge: number;
}

/**
 * Calls the travel-time API and builds the auto travel entry. Each leg quotes
 * at its own departure: outbound at job start, return at job end. Zero drive
 * time yields no entry; any non-zero drive bills the $10 minimum via
 * {@link calcTravelCharge}. Network failures throw to the caller.
 * @param input - Address, slot bounds, date and live travel pricing.
 * @returns The auto travel entry, or null when the API found no drive time.
 */
export async function lookupAutoTravel(input: AutoTravelLookup): Promise<TravelEntry | null> {
  const { jobAddress, aggregateStart, aggregateEnd, jobDate, durationMins } = input;
  // Both legs anchor to the JOB DATE's weekday so a past job is quoted
  // with the traffic pattern of the day it actually happened.
  const departureTimeIso = jobStartIsoFromTime(aggregateStart, jobDate);
  // Return departure: the job's end time, guarded against
  // jobStartIsoFromTime's independent roll-forward inverting the pair;
  // falls back to departure + estimated duration, else the server's default.
  let returnDepartureTimeIso = jobStartIsoFromTime(aggregateEnd, jobDate);
  if (departureTimeIso && returnDepartureTimeIso && returnDepartureTimeIso <= departureTimeIso) {
    returnDepartureTimeIso = new Date(
      new Date(returnDepartureTimeIso).getTime() + 24 * 60 * 60 * 1000,
    ).toISOString();
  }
  if (departureTimeIso && !returnDepartureTimeIso && durationMins > 0) {
    returnDepartureTimeIso = new Date(
      new Date(departureTimeIso).getTime() + durationMins * 60_000,
    ).toISOString();
  }
  const res = await fetch("/api/pricing/travel-time", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      destination: jobAddress,
      ...(departureTimeIso ? { departureTimeIso } : {}),
      ...(returnDepartureTimeIso ? { returnDepartureTimeIso } : {}),
    }),
  });
  const d = (await res.json()) as {
    distanceKm?: number;
    durationMinsThere?: number;
    durationMinsBack?: number;
  };
  if (!d.durationMinsThere || d.durationMinsThere <= 0) return null;
  const backMins = d.durationMinsBack || d.durationMinsThere;
  // calcTravelCharge sums the legs and floors at MIN_TRAVEL_CHARGE, so
  // a 1-min drive still bills the $10 minimum.
  const cost = calcTravelCharge(
    d.durationMinsThere,
    backMins,
    input.travelRatePerHour,
    input.minTravelCharge,
  );
  const label = jobAddress.trim() || `${d.durationMinsThere} min drive`;
  return {
    label,
    cost,
    isAuto: true,
    destination: jobAddress.trim() || label,
    durationMinsOneWay: d.durationMinsThere,
    durationMinsBack: backMins,
    distanceKmOneWay: d.distanceKm,
  };
}
