// src/features/contacts/lib/google-contacts.ts
// Google People API two-way sync. Phones merge as a union; name, email and address are
// latest-wins via `lastSyncedAt` + `lastGoogleEtag`, recording a `ContactConflict` when both changed.

import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";
import { findOrCreateContactByEmail } from "@/features/contacts/lib/find-or-create";
import { mergeEmails } from "@/features/contacts/lib/merge-emails";
import { addressCovers, resolveAddress } from "@/shared/lib/normalise-address";
import { isNZMobileKey, normaliseContactPhone, toE164NZ } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { people as googlePeople, type people_v1 } from "@googleapis/people";
import type { ContactField } from "@prisma/client";
import {
  clearContactConflict,
  recordContactConflict,
  UNRESOLVED_CONFLICT_FILTER,
} from "./contact-conflicts";
import { splitName } from "./split-name";

/**
 * Returns an authenticated Google People API client.
 * @returns People API instance.
 */
function getPeopleClient(): people_v1.People {
  const auth = getOAuth2Client();
  return googlePeople({ version: "v1", auth });
}

/** Google allows 90 contact reads a minute per user; calls 700ms apart stay under it. */
const CALL_GAP_MS = 700;
/** Wait before the one retry: the per-minute quota refills gradually, not all at once. */
const RETRY_WAIT_MS = 10_000;
let lastCallAt = 0;

/**
 * HTTP status of a People API error, when it carries one.
 * @param err - Caught error.
 * @returns The status, or null for a network error or anything else.
 */
export function googleErrorStatus(err: unknown): number | null {
  const e = err as { status?: unknown; code?: unknown; response?: { status?: unknown } } | null;
  for (const v of [e?.response?.status, e?.status, e?.code]) {
    if (typeof v === "number") return v;
  }
  return null;
}

/**
 * Whether a failed People API call may work on a retry: a rate limit or a server error.
 * @param status - HTTP status from {@link googleErrorStatus}.
 * @returns True for 429 and 5xx.
 */
export function isRetryableStatus(status: number | null): boolean {
  return status === 429 || (status !== null && status >= 500);
}

/**
 * Runs a People API call spaced {@link CALL_GAP_MS} after the last one, retrying once on a rate
 * limit or server error by default. The spacing is per instance; the sync's run lock keeps a
 * second instance from bursting alongside.
 * @param call - The API call.
 * @param retryOn - Which failure statuses get the retry.
 * @returns The call's result; throws its last error.
 */
async function peopleCall<T>(
  call: () => Promise<T>,
  retryOn: (status: number | null) => boolean = isRetryableStatus,
): Promise<T> {
  /** Waits out the gap since the last call, then claims the slot. */
  const space = async (): Promise<void> => {
    const wait = lastCallAt + CALL_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
  };
  await space();
  try {
    return await call();
  } catch (err) {
    if (!retryOn(googleErrorStatus(err))) throw err;
    await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
    await space();
    return await call();
  }
}

/** What {@link syncContactToGoogle} did with one contact. */
export type ContactSyncOutcome = "synced" | "created" | "skipped" | "failed" | "rate-limited";

/**
 * The outcome for a People API failure.
 * @param err - Caught error.
 * @returns "rate-limited" when Google is still refusing after the retry, else "failed".
 */
function failureOutcome(err: unknown): ContactSyncOutcome {
  return googleErrorStatus(err) === 429 ? "rate-limited" : "failed";
}

/**
 * Maps a geocoder resolution onto the Contact address columns. A failed lookup returns
 * no flag keys, so a Geocoding outage neither raises nor clears review flags.
 * @param raw - Address text as it arrived from Google.
 * @returns Address columns to spread into a Contact create or update.
 */
async function addressFields(raw: string): Promise<{
  address: string;
  addressUnverified?: boolean;
  addressCandidates?: string[];
}> {
  const resolution = await resolveAddress(raw);
  switch (resolution.status) {
    case "resolved":
      return { address: resolution.address, addressUnverified: false, addressCandidates: [] };
    case "ambiguous":
      return { address: raw, addressUnverified: true, addressCandidates: resolution.candidates };
    case "unresolved":
      return { address: raw, addressUnverified: true, addressCandidates: [] };
    case "skipped":
      return { address: raw };
  }
}

/**
 * Best-effort deletion of a Google contact by resource name. Never throws, so the
 * local delete or merge still succeeds.
 * @param resourceName - Google People API resource name (e.g. "people/c123").
 * @returns False when Google still has the contact; one already gone counts as deleted.
 */
export async function deleteContactFromGoogle(resourceName: string): Promise<boolean> {
  try {
    await peopleCall(() => getPeopleClient().people.deleteContact({ resourceName }));
    return true;
  } catch (err) {
    if (googleErrorStatus(err) === 404) return true;
    console.error(`[google-contacts] deleteContactFromGoogle failed for ${resourceName}:`, err);
    return false;
  }
}

/**
 * Pulls one Google contact into the local table by email, covering contacts added since
 * the last sync cron. Uses `connections.list` because `searchContacts` reads a cache that
 * can miss on a cold call. Matching goes through {@link findOrCreateContactByEmail}. Never throws.
 * @param email - Address to match, compared case-insensitively.
 * @returns The local contact id when found; otherwise whether the lookup failed, since a failure
 *   is not the same as Google having no such person.
 */
export async function importGoogleContactByEmail(
  email: string,
): Promise<{ found: true; contactId: string } | { found: false; failed: boolean }> {
  const needle = email.trim().toLowerCase();
  if (!needle) return { found: false, failed: false };
  try {
    const people = getPeopleClient();

    let pageToken: string | undefined;
    let person: people_v1.Schema$Person | null = null;
    do {
      const response = await peopleCall(() =>
        people.people.connections.list({
          resourceName: "people/me",
          personFields: "names,emailAddresses,phoneNumbers,addresses,organizations",
          pageSize: 1000,
          ...(pageToken ? { pageToken } : {}),
        }),
      );
      person =
        (response.data.connections ?? []).find((p) =>
          (p.emailAddresses ?? []).some((e) => e.value?.trim().toLowerCase() === needle),
        ) ?? null;
      // Stop paging the moment the address is found.
      pageToken = person ? undefined : (response.data.nextPageToken ?? undefined);
    } while (pageToken);

    const resourceName = person?.resourceName;
    if (!person || !resourceName) return { found: false, failed: false };

    // As in the full import: a person linked only to a deleted contact stays out, so a delete
    // whose Google side failed can't come back through this lookup. A live match still counts.
    const deletedLink = await prisma.contact.findFirst({
      where: { googleContactId: resourceName, deletedAt: { not: null } },
      select: { id: true },
    });
    if (deletedLink) {
      const live = await prisma.contact.findFirst({
        where: {
          deletedAt: null,
          OR: [
            { googleContactId: resourceName },
            { email: { equals: needle, mode: "insensitive" } },
            { altEmails: { has: needle } },
          ],
        },
        select: { id: true },
      });
      return live ? { found: true, contactId: live.id } : { found: false, failed: false };
    }

    const rawPhone = person.phoneNumbers?.[0]?.value?.trim() ?? null;
    const rawAddress = person.addresses?.[0]?.formattedValue?.trim() ?? null;
    const { contact, created } = await findOrCreateContactByEmail(needle, {
      name:
        person.names?.[0]?.displayName?.trim() ??
        person.names?.[0]?.givenName?.trim() ??
        person.organizations?.[0]?.name?.trim() ??
        needle,
      phone: rawPhone ? toE164NZ(rawPhone) || rawPhone : null,
      ...(rawAddress ? await addressFields(rawAddress) : {}),
      company: person.organizations?.[0]?.name?.trim() || null,
      googleContactId: resourceName,
    });

    // Stamp a fresh row as synced or the next push conflicts every field. One Date for
    // both stamps, or @updatedAt lands ms later and re-dirties it. An attach stays dirty.
    if (created) {
      const stampedAt = new Date();
      await prisma.contact.update({
        where: { id: contact.id },
        data: {
          lastSyncedAt: stampedAt,
          updatedAt: stampedAt,
          lastGoogleEtag: person.etag ?? null,
        },
      });
    }
    return { found: true, contactId: contact.id };
  } catch (err) {
    // Not interpolated: the address comes from a query string and arg 1 is a format string.
    console.error("[google-contacts] importGoogleContactByEmail failed for %s:", needle, err);
    return { found: false, failed: true };
  }
}

/**
 * Imports all Google contacts, linking each to a local row by Google link, then email,
 * then phone. Rows with an unchanged etag are skipped. Matching is in memory on normalised
 * keys, since a Mongo equality filter misses "Pat.Lee@Example.com" or "0210000000".
 * @returns The number of contacts created or updated (skipped rows not counted).
 */
export async function importFromGoogleContacts(): Promise<number> {
  try {
    const people = getPeopleClient();

    /** A local contact reduced to what the import compares and writes. */
    interface MatchRow {
      id: string;
      name: string;
      email: string | null;
      /** Every other address this contact answers to, all lowercased. */
      altEmails: string[];
      phone: string | null;
      address: string | null;
      company: string | null;
      googleContactId: string | null;
      lastGoogleEtag: string | null;
    }

    // Index every live contact under each key a Google person can match on.
    const liveContacts = await prisma.contact.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        altEmails: true,
        phone: true,
        altPhones: true,
        address: true,
        company: true,
        googleContactId: true,
        lastGoogleEtag: true,
      },
    });

    // A Google person linked only to a deleted contact stays out: a delete that kept Google's
    // copy (by choice, or a failed Google delete) must not come back as a new contact.
    const deletedLinks = await prisma.contact.findMany({
      where: { deletedAt: { not: null }, googleContactId: { not: null } },
      select: { googleContactId: true },
    });
    const deletedGoogleIds = new Set(deletedLinks.map((c) => c.googleContactId));
    // A field with an open conflict waits for the operator, so Google's value can't settle it.
    const heldFields = await openConflictFields();

    const byGoogleId = new Map<string, MatchRow>();
    const byEmail = new Map<string, MatchRow>();
    const byPhoneKey = new Map<string, MatchRow>();
    // Phone > email, so a phone-only Google contact can pick up a known email.
    const emailByMobileKey = new Map<string, string>();

    for (const c of liveContacts) {
      const row: MatchRow = {
        id: c.id,
        name: c.name,
        email: c.email,
        altEmails: c.altEmails,
        phone: c.phone,
        address: c.address,
        company: c.company,
        googleContactId: c.googleContactId,
        lastGoogleEtag: c.lastGoogleEtag,
      };
      if (c.googleContactId && !byGoogleId.has(c.googleContactId)) {
        byGoogleId.set(c.googleContactId, row);
      }
      for (const e of [c.email, ...c.altEmails]) {
        const key = e?.trim().toLowerCase();
        if (key && !byEmail.has(key)) byEmail.set(key, row);
      }
      for (const p of [c.phone, ...c.altPhones]) {
        const key = normaliseContactPhone(p);
        if (!key) continue;
        if (!byPhoneKey.has(key)) byPhoneKey.set(key, row);
        // Mobiles only: a shared landline would hand over the wrong person's email.
        if (c.email && isNZMobileKey(key) && !emailByMobileKey.has(key)) {
          emailByMobileKey.set(key, c.email);
        }
      }
    }

    let pageToken: string | undefined;
    let count = 0;

    do {
      // Fetch one page of connections
      const response = await peopleCall(() =>
        people.people.connections.list({
          resourceName: "people/me",
          personFields: "names,emailAddresses,phoneNumbers,addresses,organizations",
          pageSize: 100,
          ...(pageToken ? { pageToken } : {}),
        }),
      );

      const connections = response.data.connections ?? [];
      pageToken = response.data.nextPageToken ?? undefined;

      // Sequential writes with index updates, so a repeated email/phone can't race into duplicates.
      for (const person of connections) {
        const resourceName = person.resourceName;
        if (!resourceName) continue;

        // Every address, not just [0]: any of them can identify the person on a booking.
        const emailList = (person.emailAddresses ?? [])
          .map((e) => e.value?.trim().toLowerCase())
          .filter((v): v is string => !!v);
        const emailEntry = emailList[0] ?? null;
        const rawPhone = person.phoneNumbers?.[0]?.value?.trim() ?? null;
        const phone = rawPhone ? toE164NZ(rawPhone) || rawPhone : null;
        const normPhone = normaliseContactPhone(rawPhone);
        const name =
          person.names?.[0]?.displayName?.trim() ??
          person.names?.[0]?.givenName?.trim() ??
          person.organizations?.[0]?.name?.trim() ??
          null;
        const address = person.addresses?.[0]?.formattedValue?.trim() ?? null;
        const company = person.organizations?.[0]?.name?.trim() || null;
        const email = emailEntry ?? (normPhone ? (emailByMobileKey.get(normPhone) ?? null) : null);
        const etag = person.etag ?? null;

        // Google link first: it survives email or phone edits on either side.
        const googleMatch = byGoogleId.get(resourceName);
        const emailMatch = email ? byEmail.get(email) : undefined;
        // A shared landline only counts when Google has no email; a mobile always counts.
        const phoneMatch =
          normPhone && (!emailEntry || isNZMobileKey(normPhone))
            ? byPhoneKey.get(normPhone)
            : undefined;
        const existing = googleMatch ?? emailMatch ?? phoneMatch;
        // Trust a rename only on a link, email or mobile match; a landline may be a housemate.
        const renameTrusted = Boolean(googleMatch ?? emailMatch) || isNZMobileKey(normPhone);
        try {
          if (existing) {
            // Unchanged etag: skip, so updatedAt stays put and the row stays out of the push set.
            if (existing.googleContactId === resourceName && existing.lastGoogleEtag === etag) {
              continue;
            }
            // Google wins for populated fields; blanks never overwrite. Stamp with ONE Date,
            // or @updatedAt lands ms later and every row re-pushes until the cron times out.
            const stampedAt = new Date();
            const updates: Record<string, unknown> = {
              googleContactId: resourceName,
              lastSyncedAt: stampedAt,
              updatedAt: stampedAt,
              lastGoogleEtag: etag,
            };
            // Fill a placeholder name freely; overwrite a real one only on a trusted match.
            const held = heldFields.get(existing.id);
            const namePlaceholder = existing.name === phone || existing.name === normPhone;
            if (
              name &&
              !held?.has("name") &&
              (namePlaceholder || (name !== existing.name && renameTrusted))
            ) {
              updates.name = name;
            }
            // Adopt Google's email when the row has none, so the twins can't drift apart.
            if (emailEntry && !existing.email && renameTrusted) updates.email = emailEntry;
            // Writing E.164 back also repairs a domestic-form number.
            if (phone && phone !== existing.phone) updates.phone = phone;
            // Push, never set: contact merges also write altEmails. Skip a just-adopted primary.
            const knownEmails = new Set([
              ...(existing.email ? [existing.email.toLowerCase()] : []),
              ...(typeof updates.email === "string" ? [updates.email] : []),
              ...existing.altEmails.map((e) => e.toLowerCase()),
            ]);
            const newAlts = emailList.filter((e) => !knownEmails.has(e));
            if (newAlts.length > 0) updates.altEmails = { push: newAlts };
            // Geocode only a changed address, keeping repeat imports near zero calls.
            if (address && address !== existing.address && !held?.has("address")) {
              Object.assign(updates, await addressFields(address));
            }
            if (company && company !== existing.company) updates.company = company;
            await prisma.contact.update({ where: { id: existing.id }, data: updates });

            // Mirror the write onto the index: a second Google person may resolve to this row.
            existing.googleContactId = resourceName;
            existing.lastGoogleEtag = etag;
            if (typeof updates.name === "string") existing.name = updates.name;
            if (typeof updates.email === "string") existing.email = updates.email;
            if (typeof updates.phone === "string") existing.phone = updates.phone;
            if (typeof updates.address === "string") existing.address = updates.address;
            if (typeof updates.company === "string") existing.company = updates.company;
            if (newAlts.length > 0) existing.altEmails = [...existing.altEmails, ...newAlts];
            byGoogleId.set(resourceName, existing);
          } else {
            // Skip a person with no matchable key; no later run could link it.
            const displayName = name ?? email ?? phone;
            if ((!email && !normPhone) || !displayName) continue;
            if (deletedGoogleIds.has(resourceName)) continue;
            // Same-instant stamp as the update branch above.
            const stampedAt = new Date();
            const addressData = address
              ? await addressFields(address)
              : { address: null as string | null };
            const created = await prisma.contact.create({
              data: {
                name: displayName,
                email,
                altEmails: emailList.filter((e) => e !== email),
                phone,
                ...addressData,
                company,
                // Explicit null: `where: { deletedAt: null }` won't match an absent Mongo key.
                deletedAt: null,
                googleContactId: resourceName,
                lastSyncedAt: stampedAt,
                updatedAt: stampedAt,
                lastGoogleEtag: etag,
              },
              select: { id: true, name: true, address: true },
            });
            const row: MatchRow = {
              id: created.id,
              name: created.name,
              email,
              altEmails: emailList.filter((e) => e !== email),
              phone,
              address: created.address,
              company,
              googleContactId: resourceName,
              lastGoogleEtag: etag,
            };
            byGoogleId.set(resourceName, row);
            if (email) byEmail.set(email, row);
            if (normPhone) byPhoneKey.set(normPhone, row);
          }
          count++;
        } catch (importError) {
          console.error(
            `[google-contacts] Failed to import contact (resource ${resourceName}):`,
            importError,
          );
        }
      }
    } while (pageToken);

    return count;
  } catch (error) {
    console.error("[google-contacts] importFromGoogleContacts failed:", error);
    return 0;
  }
}

/**
 * Fields with an open conflict, for every contact or just one.
 * @param contactId - One contact to read, else all of them.
 * @returns Contact id > the fields waiting on the operator.
 */
async function openConflictFields(contactId?: string): Promise<Map<string, Set<ContactField>>> {
  const open = await prisma.contactConflict.findMany({
    where: { ...(contactId ? { contactId } : {}), ...UNRESOLVED_CONFLICT_FILTER },
    select: { contactId: true, field: true },
  });
  const byContact = new Map<string, Set<ContactField>>();
  for (const c of open) {
    const fields = byContact.get(c.contactId) ?? new Set<ContactField>();
    fields.add(c.field);
    byContact.set(c.contactId, fields);
  }
  return byContact;
}

/** A single-value field's sync action; "held" waits on an open conflict. */
export type FieldAction = "noop" | "push" | "pull" | "conflict" | "held";

/**
 * Holds a field that already has an open conflict: neither side may settle it until the
 * operator picks a value. Values that now agree go through, so the conflict clears.
 * @param open - Whether the field has an open conflict.
 * @param action - What the comparison decided.
 * @returns The action to take.
 */
export function holdOpenConflict(open: boolean, action: Exclude<FieldAction, "held">): FieldAction {
  return open && action !== "noop" ? "held" : action;
}

/**
 * Decides the sync action for a single-value field from which sides changed since the last sync.
 * @param siteValue - Current site value (possibly null).
 * @param googleValue - Current Google value (possibly null).
 * @param siteChanged - Whether the site row was updated since last sync.
 * @param googleChanged - Whether Google's etag differs from the stored one.
 * @returns "noop", "push" / "pull" for latest-wins, or "conflict" when both changed.
 */
function compareSingleField(
  siteValue: string | null,
  googleValue: string | null,
  siteChanged: boolean,
  googleChanged: boolean,
): Exclude<FieldAction, "held"> {
  const a = siteValue?.trim() || null;
  const b = googleValue?.trim() || null;
  if (a === b) return "noop";
  if (siteChanged && !googleChanged) return "push";
  if (!siteChanged && googleChanged) return "pull";
  if (siteChanged && googleChanged) return "conflict";
  // Neither changed but values diverge (e.g. first sync): prefer Google.
  if (b) return "pull";
  if (a) return "push";
  return "noop";
}

/**
 * Unions site + Google phones, de-duplicated by E.164 form; Google's come first so its primary stays.
 * @param sitePhones - Site's phone numbers (primary first, then alts; nulls skipped).
 * @param googlePhones - All values from Google's phoneNumbers array.
 * @returns Merged phone array suitable for pushing back to Google.
 */
function mergePhones(sitePhones: Array<string | null>, googlePhones: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of googlePhones) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    const key = normaliseContactPhone(trimmed) ?? trimmed;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  for (const sitePhone of sitePhones) {
    if (!sitePhone?.trim()) continue;
    const trimmed = sitePhone.trim();
    const key = normaliseContactPhone(trimmed) ?? trimmed;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

/**
 * Two-way sync between a site Contact and its Google counterpart (policy in the file header).
 * Company only flows Google > site, except on first create. A field with an open conflict is
 * left alone on both sides until it's resolved. Never throws.
 * @param contactId - The local DB contact ID to sync.
 * @returns What happened. A read that fails (rather than finding nobody) never creates a contact.
 */
export async function syncContactToGoogle(contactId: string): Promise<ContactSyncOutcome> {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });
    if (!contact) {
      console.warn(`[google-contacts] syncContactToGoogle: contact ${contactId} not found`);
      return "skipped";
    }
    if (contact.deletedAt) {
      // Pushing a soft-deleted contact would re-create it in Google and the import would revive it.
      return "skipped";
    }
    const email = contact.email;
    if (!email) {
      // Phone-only contacts have no email - they are imported FROM Google, not pushed to it.
      return "skipped";
    }

    const people = getPeopleClient();
    const held = (await openConflictFields(contactId)).get(contactId) ?? new Set<ContactField>();

    // Find by stored resource name, then email search; else create from site values.
    let resourceName = contact.googleContactId;
    let googlePerson: {
      etag?: string | null;
      names?: Array<{ displayName?: string | null }> | null;
      emailAddresses?: Array<{ value?: string | null }> | null;
      phoneNumbers?: Array<{ value?: string | null }> | null;
      addresses?: Array<{ formattedValue?: string | null }> | null;
      organizations?: Array<{ name?: string | null }> | null;
    } | null = null;

    if (resourceName) {
      const stored = resourceName;
      try {
        const fetched = await peopleCall(() =>
          people.people.get({
            resourceName: stored,
            personFields: "names,emailAddresses,phoneNumbers,addresses,organizations",
          }),
        );
        googlePerson = fetched.data;
      } catch (err) {
        // Only a 404 means they're gone. Searching and creating after a rate limit or an
        // outage made a second Google contact for someone Google still had.
        if (googleErrorStatus(err) !== 404) {
          console.error(`[google-contacts] Couldn't read ${stored}:`, err);
          return failureOutcome(err);
        }
        console.warn(`[google-contacts] ${stored} is gone from Google, searching by email`);
        resourceName = null;
      }
    }

    if (!resourceName) {
      try {
        // Google's search reads a cache that an empty query warms; a cold search can miss.
        await peopleCall(() => people.people.searchContacts({ query: "", readMask: "names" }));
        const searchResult = await peopleCall(() =>
          people.people.searchContacts({
            query: email,
            readMask: "names,emailAddresses,phoneNumbers,addresses,organizations",
            pageSize: 5,
          }),
        );
        const match = searchResult.data.results?.find((r) =>
          r.person?.emailAddresses?.some((e) => e.value?.toLowerCase() === email.toLowerCase()),
        );
        if (match?.person?.resourceName) {
          resourceName = match.person.resourceName;
          googlePerson = match.person;
        }
      } catch (err) {
        // A failed search isn't "nobody": creating now could duplicate them.
        console.error("[google-contacts] Search by email failed:", err);
        return failureOutcome(err);
      }
    }

    if (!resourceName || !googlePerson) {
      // No Google contact found - create a new one with all site values.
      try {
        const { givenName, familyName } = splitName(contact.name);
        // Retried only on a rate limit: after a server error Google may have made it anyway.
        const created = await peopleCall(
          () =>
            people.people.createContact({
              requestBody: {
                names: [{ displayName: contact.name, givenName, familyName }],
                emailAddresses: [{ value: email }],
                ...(contact.phone ? { phoneNumbers: [{ value: contact.phone }] } : {}),
                ...(contact.address ? { addresses: [{ formattedValue: contact.address }] } : {}),
                ...(contact.company ? { organizations: [{ name: contact.company }] } : {}),
              },
            }),
          (status) => status === 429,
        );
        if (created.data.resourceName) {
          // Same-instant stamp: see the pushOk stamp below for why.
          const stampedAt = new Date();
          await prisma.contact.update({
            where: { id: contactId },
            data: {
              googleContactId: created.data.resourceName,
              lastSyncedAt: stampedAt,
              updatedAt: stampedAt,
              lastGoogleEtag: created.data.etag ?? null,
            },
          });
        }
        return "created";
      } catch (err) {
        console.error("[google-contacts] Failed to create new Google contact:", err);
        return failureOutcome(err);
      }
    }

    // Both sides exist - decide who changed since last sync, then act.
    const currentEtag = googlePerson.etag ?? null;
    const siteChanged =
      !contact.lastSyncedAt || contact.updatedAt.getTime() > contact.lastSyncedAt.getTime();
    const googleChanged = !contact.lastGoogleEtag || currentEtag !== contact.lastGoogleEtag;

    const googleName = googlePerson.names?.[0]?.displayName?.trim() || null;
    const googleEmailList = (googlePerson.emailAddresses ?? [])
      .map((e) => e.value?.trim())
      .filter((v): v is string => !!v);
    // Google's first address is the primary for conflict purposes.
    const googleEmail = googleEmailList[0] || null;
    const googleAddress = googlePerson.addresses?.[0]?.formattedValue?.trim() || null;
    const googleCompany = googlePerson.organizations?.[0]?.name?.trim() || null;
    const googlePhoneList = (googlePerson.phoneNumbers ?? [])
      .map((p) => p.value?.trim())
      .filter((v): v is string => !!v);

    // Phones - always merge as union. No conflict semantics.
    const mergedPhones = mergePhones([contact.phone, ...contact.altPhones], googlePhoneList);
    const phonesChanged =
      mergedPhones.length !== googlePhoneList.length ||
      mergedPhones.some((p, i) => p !== googlePhoneList[i]);

    // Single-value fields - latest-wins or conflict
    const nameAction = holdOpenConflict(
      held.has("name"),
      compareSingleField(contact.name, googleName, siteChanged, googleChanged),
    );
    // Lowercased: a case-only difference is not a change.
    const emailAction = holdOpenConflict(
      held.has("email"),
      compareSingleField(
        email.toLowerCase(),
        googleEmail?.toLowerCase() ?? null,
        siteChanged,
        googleChanged,
      ),
    );
    // A disputed primary leaves the email lists alone too, or the union push would settle it.
    const emailSettled = emailAction !== "conflict" && emailAction !== "held";
    // Emails union like phones, but emailAction picks the primary (the send address).
    const primaryEmail =
      emailAction === "pull" && googleEmail ? googleEmail : (contact.email ?? googleEmail);
    const mergedEmails = mergeEmails(
      [contact.email, ...contact.altEmails],
      googleEmailList,
      primaryEmail,
    );
    const emailsChanged =
      mergedEmails.length !== googleEmailList.length ||
      mergedEmails.some((e, i) => e !== googleEmailList[i]?.toLowerCase());

    // Compare by meaning: the site stores the geocoded form, Google the typed one.
    // Push when the site's form only states the same place more fully.
    const addressAction: FieldAction = addressCovers(contact.address, googleAddress)
      ? "push"
      : holdOpenConflict(
          held.has("address"),
          compareSingleField(contact.address, googleAddress, siteChanged, googleChanged),
        );

    // Build the Google update body from the actions
    const updateBody: Record<string, unknown> = {};
    const updateFields: string[] = [];
    if (phonesChanged && mergedPhones.length > 0) {
      updateBody.phoneNumbers = mergedPhones.map((value) => ({ value }));
      updateFields.push("phoneNumbers");
    }
    if (nameAction === "push" && contact.name) {
      const { givenName, familyName } = splitName(contact.name);
      updateBody.names = [{ displayName: contact.name, givenName, familyName }];
      updateFields.push("names");
    }
    if (emailSettled && (emailAction === "push" || emailsChanged) && mergedEmails.length > 0) {
      updateBody.emailAddresses = mergedEmails.map((value) => ({ value }));
      updateFields.push("emailAddresses");
    }
    if (addressAction === "push" && contact.address) {
      updateBody.addresses = [{ formattedValue: contact.address }];
      updateFields.push("addresses");
    }

    // A failed push must not be stamped as synced, or the local edit never retries.
    let pushError: unknown = null;
    if (updateFields.length > 0 && currentEtag) {
      const target = resourceName;
      try {
        const updated = await peopleCall(() =>
          people.people.updateContact({
            resourceName: target,
            updatePersonFields: updateFields.join(","),
            requestBody: { etag: currentEtag, ...updateBody },
          }),
        );
        // Refresh etag from the response - the write above changed it.
        googlePerson.etag = updated.data.etag ?? currentEtag;
      } catch (err) {
        console.error(`[google-contacts] updateContact failed for ${target}:`, err);
        pushError = err ?? new Error("updateContact failed");
      }
    }
    const pushOk = pushError === null;

    // Build the site update from pull actions + the merged phones
    const siteUpdate: Record<string, unknown> = {
      googleContactId: resourceName,
      lastGoogleEtag: googlePerson.etag ?? currentEtag,
    };
    // ONE Date for both stamps: @updatedAt lands ms later, and the strict
    // updatedAt > lastSyncedAt check would re-push every row until the cron times out.
    if (pushOk) {
      const stampedAt = new Date();
      siteUpdate.lastSyncedAt = stampedAt;
      siteUpdate.updatedAt = stampedAt;
    }
    if (nameAction === "pull" && googleName) siteUpdate.name = googleName;
    // Lowercased, or the import's lowercased match creates a duplicate.
    if (emailAction === "pull" && googleEmail) siteUpdate.email = googleEmail.toLowerCase();
    // Primary stays on Contact.email; every other address goes to altEmails so it still matches.
    const emailTail = mergedEmails.filter((e) => e !== primaryEmail?.trim().toLowerCase());
    if (
      emailSettled &&
      (emailTail.length !== contact.altEmails.length ||
        contact.altEmails.some((e) => !emailTail.includes(e.toLowerCase())))
    ) {
      siteUpdate.altEmails = { set: emailTail };
    }
    // Company is Google-owned: take Google's value whenever it has one, never blank the site's.
    if (googleCompany && googleCompany !== contact.company) siteUpdate.company = googleCompany;
    if (addressAction === "pull" && googleAddress) {
      // Canonicalise, flagging for review without one confident match.
      Object.assign(siteUpdate, await addressFields(googleAddress));
    }
    // Primary on Contact.phone; the tail goes to altPhones so every number matches.
    if (mergedPhones[0] && mergedPhones[0] !== contact.phone) {
      siteUpdate.phone = mergedPhones[0];
    }
    const primaryKey = normaliseContactPhone(mergedPhones[0] ?? contact.phone);
    const tailKeys = new Set<string>();
    for (const p of mergedPhones.slice(1)) {
      const key = normaliseContactPhone(p);
      if (key && key !== primaryKey) tailKeys.add(key);
    }
    if (
      tailKeys.size !== contact.altPhones.length ||
      contact.altPhones.some((p) => !tailKeys.has(normaliseContactPhone(p) ?? p))
    ) {
      siteUpdate.altPhones = { set: [...tailKeys] };
    }

    await prisma.contact.update({ where: { id: contactId }, data: siteUpdate });

    // Record / clear conflicts per single-value field; a held one stays open
    const fields = [
      ["name", nameAction, contact.name, googleName],
      ["email", emailAction, email, googleEmail],
      ["address", addressAction, contact.address, googleAddress],
    ] as const;
    for (const [field, action, siteValue, googleValue] of fields) {
      if (action === "conflict") {
        await recordContactConflict({ contactId, field, siteValue, googleValue });
      } else if (action !== "held") {
        await clearContactConflict(contactId, field);
      }
    }
    return pushOk ? "synced" : failureOutcome(pushError);
  } catch (error) {
    console.error(`[google-contacts] syncContactToGoogle failed for ${contactId}:`, error);
    return "failed";
  }
}
