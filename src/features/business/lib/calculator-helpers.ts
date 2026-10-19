// src/features/business/lib/calculator-helpers.ts
// Job calculator helpers: date/time arithmetic, task-line re-pricing and travel lookups.

import { effectiveHourlyRate, isChannelModifier, todayISO } from "@/features/business/lib/business";
import { calcTravelCharge } from "@/features/business/lib/pricing-policy";
import { isHourlyTask } from "@/features/business/lib/task-timing";
import type { RateConfig, TaskLine, TravelEntry } from "@/features/business/types/business";
import { roundCents } from "@/shared/lib/money";
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
 * UTC ISO timestamp for an HH:MM NZ start on the next occurrence of the job date's weekday.
 * Google only quotes future traffic, so a past job uses the same weekday and time as a proxy.
 * @param hhmm - Start time in HH:MM (24h) NZ wall-clock.
 * @param anchorDate - NZ YYYY-MM-DD whose weekday to match; malformed falls back to today.
 * @returns ISO 8601 UTC timestamp, or null for an invalid time.
 */
function jobStartIsoFromTime(hhmm: string, anchorDate?: string): string | null {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = timeParts(hhmm);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return nextNzWallClockOnWeekday(h, m, anchorDate).toISOString();
}

/**
 * Builds an empty hourly task line at the default base rate with no modifiers.
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
 * Updates one field on a task line, re-totalling it and filling from a picked rate config.
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
  // Minutes are the billed unit on hourly rows, so a typed qty must rewrite them. It is
  // already whole minutes (hrs + mins inputs): snap it and keep qty unrounded.
  if (field === "qty") {
    const mins = Math.round(Number(val) * 60);
    if (isHourlyTask(item)) {
      item.minutes = mins;
      item.qty = mins / 60;
      // A typed time is the operator's own, so window fitting must keep it.
      item.isShort = false;
      item.isExplicit = true;
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
      item.lineTotal = roundCents(item.qty * item.unitPrice);
    }
  }
  // A typed $/hr is deliberate, so a draft restore must not re-price it from the rate.
  if (field === "unitPrice") item.priceOverridden = true;
  if (field === "qty" || field === "unitPrice") {
    item.lineTotal = roundCents(Number(item.qty) * Number(item.unitPrice));
  }
  t[idx] = item;
  return t;
}

/**
 * Toggles a modifier rate on a task and re-prices it from base + modifiers.
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
    // One delivery channel per task: a second one swaps in, so discounts never compound.
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
    lineTotal: roundCents(target.qty * newPrice),
    priceOverridden: false,
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
    lineTotal: roundCents(target.qty * newPrice),
    priceOverridden: false,
  };
  return arr;
}

/**
 * Re-prices every hourly line from the live rates, so a restored draft doesn't bill a stale
 * rate. A typed $/hr is left alone.
 * @param tasks - Task lines, e.g. from a saved draft.
 * @param rates - Live rate configs.
 * @returns The lines with hourly prices brought up to date; flat and untagged lines unchanged.
 */
export function repriceHourlyTasks(tasks: TaskLine[], rates: RateConfig[]): TaskLine[] {
  return tasks.map((t) => {
    if (t.priceOverridden) return t;
    const live = effectiveHourlyRate(rates, t.baseRateId, t.modifierIds);
    if (live <= 0 || live === t.unitPrice) return t;
    return { ...t, unitPrice: live, lineTotal: roundCents(t.qty * live) };
  });
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
 * Builds the auto travel entry from the travel-time API, outbound at job start and return at
 * job end. Network failures throw.
 * @param input - Address, slot bounds, date and live travel pricing.
 * @returns The auto travel entry, or null when the API found no drive time.
 */
export async function lookupAutoTravel(input: AutoTravelLookup): Promise<TravelEntry | null> {
  const { jobAddress, aggregateStart, aggregateEnd, jobDate, durationMins } = input;
  const departureTimeIso = jobStartIsoFromTime(aggregateStart, jobDate);
  // Each leg rolls forward on its own, so push an inverted return a day on; without an end
  // time, use departure + duration.
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
  // Floors at the minimum charge, so a 1-min drive still bills it.
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

/**
 * Builds a store-run travel entry priced like client travel but with no minimum (can be $0).
 * @param store - The store, as named.
 * @param thereMins - Drive minutes from the client to the store.
 * @param backMins - Drive minutes from the store back to the client.
 * @param distanceKm - One-way km, client to store.
 * @param travelRatePerHour - Live travel rate.
 * @returns The store-run entry.
 */
export function storeRunEntry(
  store: string,
  thereMins: number,
  backMins: number,
  distanceKm: number | undefined,
  travelRatePerHour: number,
): TravelEntry {
  return {
    label: store,
    kind: "storeRun",
    cost: calcTravelCharge(thereMins, backMins, travelRatePerHour, 0),
    destination: store,
    durationMinsOneWay: thereMins,
    durationMinsBack: backMins,
    distanceKmOneWay: distanceKm,
  };
}

/**
 * Times a store run through the admin store-run route and prices it.
 * @param from - The client's address.
 * @param store - The store, by name and branch or by address.
 * @param travelRatePerHour - Live travel rate.
 * @returns The priced entry, or an error message to show the operator.
 */
export async function lookupStoreRunEntry(
  from: string,
  store: string,
  travelRatePerHour: number,
): Promise<{ entry: TravelEntry } | { error: string }> {
  try {
    const res = await fetch("/api/business/store-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, store }),
    });
    const d = (await res.json()) as {
      error?: string;
      distanceKm?: number;
      durationMinsThere?: number;
      durationMinsBack?: number;
    };
    if (!res.ok) return { error: d.error ?? "Couldn't look up the store run." };
    if (!d.durationMinsThere || d.durationMinsThere <= 0) {
      return { error: `Couldn't find a drive to ${store}. Try adding the suburb.` };
    }
    const back = d.durationMinsBack || d.durationMinsThere;
    return {
      entry: storeRunEntry(store, d.durationMinsThere, back, d.distanceKm, travelRatePerHour),
    };
  } catch {
    return { error: "Couldn't look up the store run." };
  }
}
