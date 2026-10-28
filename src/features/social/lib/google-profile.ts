// src/features/social/lib/google-profile.ts
// Works out which Google Business Profile details differ from Settings: the phone number,
// website and opening hours. Pure, so the check script covers it; google-business.ts reads the
// profile and sends the changes. The name and address are never written: a name edit can send
// the profile back through Google's verification, and the base address is the owner's home.

import { advertisedHours } from "@/shared/lib/advertised-hours";
import type { Settings } from "@/shared/lib/settings/types";
import { DAY_NAMES } from "@/shared/lib/timezone-utils";

interface TimeOfDay {
  hours?: number;
  minutes?: number;
}

/** One open stretch (Business Information v1 TimePeriod). */
interface TimePeriod {
  openDay: string;
  openTime: TimeOfDay;
  closeDay: string;
  closeTime: TimeOfDay;
}

/** The location fields the site keeps in step (Business Information v1 Location). */
export interface ProfileDetails {
  phoneNumbers?: { primaryPhone?: string; additionalPhones?: string[] };
  websiteUri?: string;
  regularHours?: { periods?: TimePeriod[] };
}

/** What a Settings save did to the profile, for the save message. */
export type ProfileSyncResult =
  | { status: "updated"; fields: string[] }
  | { status: "unchanged" }
  | { status: "not-connected" }
  | { status: "failed"; error: string };

/** The changes to send: the update mask, the body and a plain name for each field. */
export interface ProfileChanges {
  mask: string[];
  body: ProfileDetails;
  labels: string[];
}

/**
 * A phone number's digits with NZ's leading 0 swapped for 64, so "021 297 1237" and
 * "+64 21 297 1237" compare equal.
 * @param phone - Any written form of the number.
 * @returns The comparable digits.
 */
function phoneKey(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^0/, "64");
}

/**
 * A website's host and path, ignoring the scheme, "www.", a trailing slash and the query, so a
 * tracking link Google holds (?utm_source=...) still counts as the same site.
 * @param url - A URL, with or without its scheme.
 * @returns The comparable form.
 */
function siteKey(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * A time as "H:MM". Google leaves out zero fields, so 00:00 reads back as {} and the missing
 * parts count as 0.
 * @param t - The time.
 * @returns The comparable form.
 */
function timeKey(t: TimeOfDay): string {
  return `${t.hours ?? 0}:${String(t.minutes ?? 0).padStart(2, "0")}`;
}

/**
 * A week of periods as one sortable string.
 * @param periods - The periods, in any order.
 * @returns The comparable form.
 */
function hoursKey(periods: TimePeriod[]): string {
  return periods
    .map((p) => `${p.openDay} ${timeKey(p.openTime)} ${p.closeDay} ${timeKey(p.closeTime)}`)
    .sort()
    .join(",");
}

/**
 * The fields where the profile differs from Settings, ready to PATCH.
 * @param settings - Settings as just saved.
 * @param current - The profile's phone numbers, website and hours as Google has them.
 * @returns The update mask, body and labels; an empty mask when nothing differs.
 */
export function profileChanges(settings: Settings, current: ProfileDetails): ProfileChanges {
  const changes: ProfileChanges = { mask: [], body: {}, labels: [] };
  const { identity, availability } = settings;

  // Google only takes both phone fields together, so any extra numbers go back unchanged.
  const phone = identity.phoneTel.replace(/^tel:/i, "").trim();
  if (phone && phoneKey(phone) !== phoneKey(current.phoneNumbers?.primaryPhone ?? "")) {
    changes.mask.push("phoneNumbers");
    changes.body.phoneNumbers = {
      primaryPhone: phone,
      additionalPhones: current.phoneNumbers?.additionalPhones ?? [],
    };
    changes.labels.push("phone number");
  }

  const website = identity.website.trim();
  if (website && siteKey(website) !== siteKey(current.websiteUri ?? "")) {
    changes.mask.push("websiteUri");
    changes.body.websiteUri = /^https?:\/\//i.test(website) ? website : `https://${website}`;
    changes.labels.push("website");
  }

  // With no open days, skip the hours rather than wipe them, which reads as "hours unknown".
  const periods = advertisedHours(identity, availability).map(({ day, open, close }) => {
    const name = DAY_NAMES[day].toUpperCase();
    return {
      openDay: name,
      openTime: { hours: open },
      closeDay: name,
      closeTime: { hours: close },
    };
  });
  if (periods.length > 0 && hoursKey(periods) !== hoursKey(current.regularHours?.periods ?? [])) {
    changes.mask.push("regularHours");
    changes.body.regularHours = { periods };
    changes.labels.push("opening hours");
  }

  return changes;
}
