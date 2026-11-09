// src/features/contacts/lib/contact-sort.ts
// Sort keys, labels and the comparator for the admin contacts list, shared by the table's
// column headers and the sort dropdown.

import type { ContactRow } from "@/features/contacts/components/ContactCard";
import { normaliseContactPhone } from "@/shared/lib/normalise-phone";

/** What the list can sort on: a table column, or the date the contact was added. */
export type ContactSortKey = "name" | "added" | "email" | "phone" | "address" | "reviewed";

/** Sort direction. */
export type SortDir = "asc" | "desc";

/** Every sort key, for validating the URL's `sort` value. */
export const CONTACT_SORT_KEYS: readonly ContactSortKey[] = [
  "name",
  "added",
  "email",
  "phone",
  "address",
  "reviewed",
];

/**
 * The direction a key starts in when first picked: dates and review counts biggest first,
 * text A-Z.
 * @param key - Sort key.
 * @returns The key's starting direction.
 */
export function firstDir(key: ContactSortKey): SortDir {
  return key === "added" || key === "reviewed" ? "desc" : "asc";
}

/** Dropdown choices: every key in both directions, so any header sort has its option. */
export const CONTACT_SORT_OPTIONS: readonly { key: ContactSortKey; dir: SortDir; label: string }[] =
  [
    { key: "name", dir: "asc", label: "Name A-Z" },
    { key: "name", dir: "desc", label: "Name Z-A" },
    { key: "added", dir: "desc", label: "Newest first" },
    { key: "added", dir: "asc", label: "Oldest first" },
    { key: "email", dir: "asc", label: "Email A-Z" },
    { key: "email", dir: "desc", label: "Email Z-A" },
    { key: "phone", dir: "asc", label: "Phone 0-9" },
    { key: "phone", dir: "desc", label: "Phone 9-0" },
    { key: "address", dir: "asc", label: "Street A-Z" },
    { key: "address", dir: "desc", label: "Street Z-A" },
    { key: "reviewed", dir: "desc", label: "Most reviews" },
    { key: "reviewed", dir: "asc", label: "Fewest reviews" },
  ];

/** A leading house or unit number ("23B ", "2/14 ", "307-81 "), skipped so addresses sort by street. */
const HOUSE_NUMBER_RE = /^\s*[\d/-]+[a-z]?\s+/i;

/** Text order for names, emails and streets: case-blind, with digit runs compared as numbers. */
const COLLATOR = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/**
 * Phone order: digit by digit, so numbers group by prefix (021, 022, 027). Comparing them
 * as numbers would put every 9-digit mobile before every 10-digit one.
 */
const PHONE_COLLATOR = new Intl.Collator("en");

/**
 * The value a contact sorts by under `key`, or null when that field is blank.
 * @param c - Contact row.
 * @param key - Sort key.
 * @returns The sort value, or null for a blank field.
 */
function sortValue(c: ContactRow, key: ContactSortKey): string | number | null {
  switch (key) {
    case "name":
      return c.name.trim() || null;
    case "added":
      return new Date(c.createdAt).getTime();
    case "email":
      return c.email?.trim() || null;
    case "phone":
      // The matching key, so "021 877 983" and "+64 21 877 983" sort as one number.
      return normaliseContactPhone(c.phone);
    case "address":
      return c.address?.replace(HOUSE_NUMBER_RE, "").trim() || null;
    case "reviewed":
      return c.reviews.length;
  }
}

/**
 * Orders two contacts by `key` and `dir`. Blank fields go last in both directions, so
 * "Email A-Z" doesn't open on a screen of "No email"; ties fall back to name A-Z.
 * @param a - First contact.
 * @param b - Second contact.
 * @param key - Sort key.
 * @param dir - Sort direction.
 * @returns Negative, zero or positive, as Array.prototype.sort expects.
 */
export function compareContacts(
  a: ContactRow,
  b: ContactRow,
  key: ContactSortKey,
  dir: SortDir,
): number {
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  let order = 0;
  if (av === null || bv === null) {
    if (av !== bv) return av === null ? 1 : -1;
  } else {
    if (typeof av === "number" && typeof bv === "number") order = av - bv;
    else order = (key === "phone" ? PHONE_COLLATOR : COLLATOR).compare(String(av), String(bv));
    if (dir === "desc") order = -order;
  }
  if (order !== 0 || key === "name") return order;
  return COLLATOR.compare(a.name, b.name);
}
