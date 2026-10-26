// src/features/business/lib/holiday-calendar.ts
// Offline holiday calendar: date-holidays plus the eves billed at holiday rates. Fallback for
// the PublicHoliday table, and the refresh cron's list of eves to keep.

import { HOME_REGION, NZ_REGION } from "@/features/business/lib/pricing-policy";
import Holidays from "date-holidays";

/** A holiday as the surcharge lookups return it. */
export interface HolidayMatch {
  name: string;
  region: string;
}

/**
 * Eves billed at holiday rates though they aren't public holidays, keyed by NZ-local MM-DD.
 * Names match Google's NZ holiday calendar, which the refresh cron reads.
 */
export const SURCHARGED_OBSERVANCES: ReadonlyArray<{ monthDay: string; name: string }> = [
  { monthDay: "12-24", name: "Christmas Eve" },
  { monthDay: "12-31", name: "New Year's Eve" },
];

// Nationwide and Auckland (anniversary day) instances; algorithmic, so one serves every year.
const hdNz = new Holidays("NZ");
const hdAuckland = new Holidays("NZ", "AUK");

/**
 * Scans a `date-holidays` result list for a public holiday on the given NZ-local date key.
 * @param list - List of holidays for one year from a `Holidays` instance.
 * @param key - NZ-local YYYY-MM-DD date string.
 * @param region - Region label to tag the match with.
 * @returns The match, or null.
 */
function matchInHolidayList(
  list: ReturnType<typeof hdNz.getHolidays>,
  key: string,
  region: string,
): HolidayMatch | null {
  for (const h of list) {
    if (h.type !== "public") continue;
    if (typeof h.date === "string" && h.date.slice(0, 10) === key) {
      return { name: h.name, region };
    }
  }
  return null;
}

/**
 * The weekday a public holiday on this NZ-local date is taken on instead, when it lands on a
 * weekend (ANZAC Day on Sat 25 Apr 2026 is taken Mon 27 Apr). The taken day bills holiday
 * rates and the date itself bills as a weekend. Substitutes land within 3 days, in the same
 * year: Christmas on a Saturday moves to Monday and Boxing Day on the Sunday to Tuesday.
 * @param key - NZ-local YYYY-MM-DD date string.
 * @returns The taken day's YYYY-MM-DD key, or null when the date's holiday isn't moved or
 * there is none.
 */
export function holidayTakenOn(key: string): string | null {
  const yearInt = parseInt(key.slice(0, 4), 10);
  if (!Number.isFinite(yearInt)) return null;
  const [, month, day] = key.split("-").map(Number);
  const until = new Date(Date.UTC(yearInt, month! - 1, day! + 3)).toISOString().slice(0, 10);
  const list = hdNz.getHolidays(yearInt);
  for (const h of list) {
    if (h.type !== "public" || h.substitute || h.date.slice(0, 10) !== key) continue;
    // "ANZAC Day (substitute day)": the same name, a few days on.
    const sub = list.find((s) => {
      const subKey = s.date.slice(0, 10);
      return s.substitute && s.name.startsWith(`${h.name} (`) && subKey > key && subKey <= until;
    });
    if (sub) return sub.date.slice(0, 10);
  }
  return null;
}

/**
 * The holiday on an NZ-local date without the database: a nationwide public holiday, then a
 * surcharged eve, then Auckland's anniversary day. The package names every province's
 * anniversary "Provincial anniversary day", so the home region's is renamed after it. A
 * weekend holiday taken later still matches here; {@link holidayTakenOn} decides its billing.
 * @param key - NZ-local YYYY-MM-DD date string.
 * @returns The match, or null when the date holds no holiday.
 */
export function offlineHoliday(key: string): HolidayMatch | null {
  const yearInt = parseInt(key.slice(0, 4), 10);
  if (!Number.isFinite(yearInt)) return null;
  const nz = matchInHolidayList(hdNz.getHolidays(yearInt), key, NZ_REGION);
  if (nz) return nz;
  const eve = SURCHARGED_OBSERVANCES.find((o) => o.monthDay === key.slice(5, 10));
  if (eve) return { name: eve.name, region: NZ_REGION };
  const home = matchInHolidayList(hdAuckland.getHolidays(yearInt), key, HOME_REGION);
  return home && /anniversary/i.test(home.name)
    ? { ...home, name: `${HOME_REGION} Anniversary Day` }
    : home;
}
