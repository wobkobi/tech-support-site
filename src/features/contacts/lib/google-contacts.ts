// src/features/contacts/lib/google-contacts.ts
/**
 * @description Google People API bidirectional sync. Phones merge as a union
 * (never overwrite). Single-value fields (name, email, address) are latest-wins
 * via `lastSyncedAt` + `lastGoogleEtag`; if both sides changed and differ, a
 * `ContactConflict` is recorded and the admin resolves it. First-time sync
 * (lastSyncedAt null) lets Google win for any field it has populated.
 */

import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";
import { resolveAddress } from "@/shared/lib/normalise-address";
import { isNZMobileKey, normaliseContactPhone, toE164NZ } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { google } from "googleapis";
import { clearContactConflict, recordContactConflict } from "./contact-conflicts";
import { splitName } from "./split-name";

/**
 * Returns an authenticated Google People API client.
 * @returns People API instance.
 */
function getPeopleClient(): ReturnType<typeof google.people> {
  const auth = getOAuth2Client();
  return google.people({ version: "v1", auth });
}

/**
 * Maps a geocoder resolution onto the Contact address columns. A confident
 * match stores the canonical form and clears the review flags; an ambiguous or
 * unmatched address stores the raw text and raises them. A failed lookup
 * returns the raw text with no flag keys at all, so a Geocoding outage cannot
 * mark a whole sync pass for review or clear a flag that is still valid.
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
 * Best-effort deletion of a Google contact by resource name. Used when a local
 * contact is deleted or merged away so the Google side doesn't keep a stale row.
 * Never throws - a failure here must not fail the local operation.
 * @param resourceName - Google People API resource name (e.g. "people/c123").
 */
export async function deleteContactFromGoogle(resourceName: string): Promise<void> {
  try {
    await getPeopleClient().people.deleteContact({ resourceName });
  } catch (err) {
    console.error(`[google-contacts] deleteContactFromGoogle failed for ${resourceName}:`, err);
  }
}

/**
 * Imports all contacts from Google Contacts into the local database.
 * Paginates through all People API connections and links each Google person to
 * its local row by stored Google link, then email, then phone. Rows whose stored
 * `googleContactId` + `lastGoogleEtag` already match are skipped - the etag only
 * changes when Google's copy changes, and the skip keeps `updatedAt` untouched
 * so unchanged rows stay out of the push dirty set. Stores the Google resource
 * name as `googleContactId`.
 *
 * Matching happens in memory against normalised keys rather than in the query.
 * A Mongo equality filter only matches the stored string exactly, so a contact
 * saved as "Tina0261@outlook.com" or "0210311047" never matched Google's
 * lowercased email or E.164 phone and was re-created as a duplicate on every
 * single run.
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
      phone: string | null;
      address: string | null;
      googleContactId: string | null;
      lastGoogleEtag: string | null;
    }

    // Index every live contact once, under each key a Google person can be
    // matched on. The whole live set is loaded because the normalised forms
    // can't be expressed as a query filter.
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
        googleContactId: true,
        lastGoogleEtag: true,
      },
    });

    const byGoogleId = new Map<string, MatchRow>();
    const byEmail = new Map<string, MatchRow>();
    const byPhoneKey = new Map<string, MatchRow>();
    // Phone > email, so a phone-only Google contact can be matched to a known
    // email and imported.
    const emailByMobileKey = new Map<string, string>();

    for (const c of liveContacts) {
      const row: MatchRow = {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        address: c.address,
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
        // Only resolve a phone-only Google contact to an email by a MOBILE match;
        // landlines are often shared, so a landline hit would give the Google
        // contact the wrong person's email (and merge them).
        if (c.email && isNZMobileKey(key) && !emailByMobileKey.has(key)) {
          emailByMobileKey.set(key, c.email);
        }
      }
    }

    let pageToken: string | undefined;
    let count = 0;

    do {
      // Fetch one page of connections
      const response = await people.people.connections.list({
        resourceName: "people/me",
        personFields: "names,emailAddresses,phoneNumbers,addresses,organizations",
        pageSize: 100,
        ...(pageToken ? { pageToken } : {}),
      });

      const connections = response.data.connections ?? [];
      pageToken = response.data.nextPageToken ?? undefined;

      // Writes stay sequential so a page that contains the same email/phone twice
      // (rare but possible) doesn't race itself into duplicate records. The
      // indexes are updated after each create so later iterations see the new row.
      for (const person of connections) {
        const resourceName = person.resourceName;
        if (!resourceName) continue;

        const emailEntry = person.emailAddresses?.[0]?.value?.trim().toLowerCase() ?? null;
        const rawPhone = person.phoneNumbers?.[0]?.value?.trim() ?? null;
        const phone = rawPhone ? toE164NZ(rawPhone) || rawPhone : null;
        const normPhone = normaliseContactPhone(rawPhone);
        const name =
          person.names?.[0]?.displayName?.trim() ??
          person.names?.[0]?.givenName?.trim() ??
          person.organizations?.[0]?.name?.trim() ??
          null;
        const address = person.addresses?.[0]?.formattedValue?.trim() ?? null;
        const email = emailEntry ?? (normPhone ? (emailByMobileKey.get(normPhone) ?? null) : null);
        const etag = person.etag ?? null;

        // The stored Google link is tried first: it survives an email or phone
        // edit on either side, so it holds the pair together when the other
        // keys drift apart.
        const googleMatch = byGoogleId.get(resourceName);
        const emailMatch = email ? byEmail.get(email) : undefined;
        // A landline stands in as the identity only when Google offers nothing
        // better: the number is often shared, so matching an email-bearing
        // Google person onto a household landline would hijack the row of
        // whoever else lives there. A mobile is personal, so it always counts.
        const phoneMatch =
          normPhone && (!emailEntry || isNZMobileKey(normPhone))
            ? byPhoneKey.get(normPhone)
            : undefined;
        const existing = googleMatch ?? emailMatch ?? phoneMatch;
        // A rename is only trusted when the row was found by its Google link,
        // its email, or a mobile - a bare landline hit is often another member
        // of the same household, and linking the id already stops the duplicate.
        const renameTrusted = Boolean(googleMatch ?? emailMatch) || isNZMobileKey(normPhone);
        try {
          if (existing) {
            // Nothing to pull when the stored link and etag both match - the
            // etag only moves when Google's copy changes. Skipping the rewrite
            // keeps updatedAt untouched so unchanged rows never enter the push
            // dirty set.
            if (existing.googleContactId === resourceName && existing.lastGoogleEtag === etag) {
              continue;
            }
            // First-sync pull: on import, Google's values flow into the site DB
            // (Google wins for any field it has populated). The blank-safety
            // rule means empty Google values never overwrite existing site data.
            // Stamping lastSyncedAt + lastGoogleEtag here is critical: without
            // it the next syncContactToGoogle would see the etag as "changed"
            // and conflict every field. lastSyncedAt and updatedAt must be the
            // SAME instant: left to auto-stamp, @updatedAt lands a few ms after
            // this new Date(), so the strict updatedAt > lastSyncedAt dirty
            // check would re-push the row every run and the cron never finishes.
            const stampedAt = new Date();
            const updates: Record<string, unknown> = {
              googleContactId: resourceName,
              lastSyncedAt: stampedAt,
              updatedAt: stampedAt,
              lastGoogleEtag: etag,
            };
            // Fill a placeholder name freely; a real local name is only
            // overwritten on a trusted match.
            const namePlaceholder = existing.name === phone || existing.name === normPhone;
            if (name && (namePlaceholder || (name !== existing.name && renameTrusted))) {
              updates.name = name;
            }
            // Adopt Google's email when the row has none, so a phone-only row
            // and its email-bearing Google twin can't drift into two rows.
            if (emailEntry && !existing.email && renameTrusted) updates.email = emailEntry;
            // Writing the E.164 form back also repairs a number stored in
            // domestic form, which is what made the row unmatchable on import.
            if (phone && phone !== existing.phone) updates.phone = phone;
            // Canonicalise hand-typed Google addresses, but only when the value
            // actually changed - keeps Geocoding calls near zero on repeat
            // imports. Flags ride along in the same stamped update.
            if (address && address !== existing.address) {
              Object.assign(updates, await addressFields(address));
            }
            await prisma.contact.update({ where: { id: existing.id }, data: updates });

            // Mirror the write onto the indexed row: two Google people can
            // resolve to one local contact, and the second must compare against
            // what the first just wrote rather than the pre-run state.
            existing.googleContactId = resourceName;
            existing.lastGoogleEtag = etag;
            if (typeof updates.name === "string") existing.name = updates.name;
            if (typeof updates.email === "string") existing.email = updates.email;
            if (typeof updates.phone === "string") existing.phone = updates.phone;
            if (typeof updates.address === "string") existing.address = updates.address;
            byGoogleId.set(resourceName, existing);
          } else {
            // Nothing to match this person on - skip rather than store a row no
            // later run could link back to its Google contact.
            const displayName = name ?? email ?? phone;
            if ((!email && !normPhone) || !displayName) continue;
            // Same-instant stamp as the update branch above.
            const stampedAt = new Date();
            const addressData = address
              ? await addressFields(address)
              : { address: null as string | null };
            const created = await prisma.contact.create({
              data: {
                name: displayName,
                email,
                phone,
                ...addressData,
                // Explicit null: an omitted optional field has no key in
                // MongoDB, and `where: { deletedAt: null }` doesn't match a
                // missing key - the imported contact would be invisible.
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
              phone,
              address: created.address,
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
 * Compares site + Google values of a single-value field, considering which
 * sides changed since the last sync, and returns the action the sync should
 * take. See file header for the policy.
 * @param siteValue - Current site value (possibly null).
 * @param googleValue - Current Google value (possibly null).
 * @param siteChanged - Whether the site row was updated since last sync.
 * @param googleChanged - Whether Google's etag differs from the stored one.
 * @returns "noop" if values match, "push" / "pull" for latest-wins,
 *   "conflict" when both sides changed and values diverge.
 */
function compareSingleField(
  siteValue: string | null,
  googleValue: string | null,
  siteChanged: boolean,
  googleChanged: boolean,
): "noop" | "push" | "pull" | "conflict" {
  const a = siteValue?.trim() || null;
  const b = googleValue?.trim() || null;
  if (a === b) return "noop";
  if (siteChanged && !googleChanged) return "push";
  if (!siteChanged && googleChanged) return "pull";
  if (siteChanged && googleChanged) return "conflict";
  // Neither changed but values diverge (e.g. first sync ever, or external
  // tampering). Prefer Google so the admin's manual edits aren't trampled.
  if (b) return "pull";
  if (a) return "push";
  return "noop";
}

/**
 * Returns the union of site + Google phone numbers, deduplicated by
 * normalised E.164 form. The order is preserved: Google's existing phones
 * first (so its primary stays primary), then any new ones the site added.
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
 * Bidirectional sync between a site Contact and its Google counterpart.
 * Phones merge as a union; name/email/address use latest-wins via lastSyncedAt
 * + etag, recording a ContactConflict when both sides changed and diverge.
 * Stamps lastSyncedAt + lastGoogleEtag on success. Never throws.
 * @param contactId - The local DB contact ID to sync.
 */
export async function syncContactToGoogle(contactId: string): Promise<void> {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });
    if (!contact) {
      console.warn(`[google-contacts] syncContactToGoogle: contact ${contactId} not found`);
      return;
    }
    if (!contact.email) {
      // Phone-only contacts have no email - they are imported FROM Google, not pushed to it.
      return;
    }

    const people = getPeopleClient();

    // Locate the Google contact: prefer the stored resource name, fall back
    // to email search. If neither finds one, create a fresh Google contact
    // using site values - that's an unambiguous first sync.
    let resourceName = contact.googleContactId;
    let googlePerson: {
      etag?: string | null;
      names?: Array<{ displayName?: string | null }> | null;
      emailAddresses?: Array<{ value?: string | null }> | null;
      phoneNumbers?: Array<{ value?: string | null }> | null;
      addresses?: Array<{ formattedValue?: string | null }> | null;
    } | null = null;

    if (resourceName) {
      try {
        const fetched = await people.people.get({
          resourceName,
          personFields: "names,emailAddresses,phoneNumbers,addresses",
        });
        googlePerson = fetched.data;
      } catch (err) {
        console.error(
          `[google-contacts] Stored googleContactId ${resourceName} not fetchable, will search by email:`,
          err,
        );
        resourceName = null;
      }
    }

    if (!resourceName) {
      // Search Google by email
      try {
        const searchResult = await people.people.searchContacts({
          query: contact.email,
          readMask: "names,emailAddresses,phoneNumbers,addresses",
          pageSize: 5,
        });
        const match = searchResult.data.results?.find((r) =>
          r.person?.emailAddresses?.some(
            (e) => e.value?.toLowerCase() === contact.email!.toLowerCase(),
          ),
        );
        if (match?.person?.resourceName) {
          resourceName = match.person.resourceName;
          googlePerson = match.person;
        }
      } catch (err) {
        console.error("[google-contacts] Search by email failed:", err);
      }
    }

    if (!resourceName || !googlePerson) {
      // No Google contact found - create a new one with all site values.
      try {
        const { givenName, familyName } = splitName(contact.name);
        const created = await people.people.createContact({
          requestBody: {
            names: [{ displayName: contact.name, givenName, familyName }],
            emailAddresses: [{ value: contact.email }],
            ...(contact.phone ? { phoneNumbers: [{ value: contact.phone }] } : {}),
            ...(contact.address ? { addresses: [{ formattedValue: contact.address }] } : {}),
          },
        });
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
      } catch (err) {
        console.error("[google-contacts] Failed to create new Google contact:", err);
      }
      return;
    }

    // Both sides exist - decide who changed since last sync, then act.
    const currentEtag = googlePerson.etag ?? null;
    const siteChanged =
      !contact.lastSyncedAt || contact.updatedAt.getTime() > contact.lastSyncedAt.getTime();
    const googleChanged = !contact.lastGoogleEtag || currentEtag !== contact.lastGoogleEtag;

    const googleName = googlePerson.names?.[0]?.displayName?.trim() || null;
    const googleEmail = googlePerson.emailAddresses?.[0]?.value?.trim() || null;
    const googleAddress = googlePerson.addresses?.[0]?.formattedValue?.trim() || null;
    const googlePhoneList = (googlePerson.phoneNumbers ?? [])
      .map((p) => p.value?.trim())
      .filter((v): v is string => !!v);

    // Phones - always merge as union. No conflict semantics.
    const mergedPhones = mergePhones([contact.phone, ...contact.altPhones], googlePhoneList);
    const phonesChanged =
      mergedPhones.length !== googlePhoneList.length ||
      mergedPhones.some((p, i) => p !== googlePhoneList[i]);

    // Single-value fields - latest-wins or conflict
    const nameAction = compareSingleField(contact.name, googleName, siteChanged, googleChanged);
    // Emails compare lowercased: a case-only difference is not a change, and
    // treating it as one would push, pull or raise a conflict on every run.
    const emailAction = compareSingleField(
      contact.email?.toLowerCase() ?? null,
      googleEmail?.toLowerCase() ?? null,
      siteChanged,
      googleChanged,
    );
    const addressAction = compareSingleField(
      contact.address,
      googleAddress,
      siteChanged,
      googleChanged,
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
    if (emailAction === "push" && contact.email) {
      updateBody.emailAddresses = [{ value: contact.email }];
      updateFields.push("emailAddresses");
    }
    if (addressAction === "push" && contact.address) {
      updateBody.addresses = [{ formattedValue: contact.address }];
      updateFields.push("addresses");
    }

    // Track push success so a failed write to Google is not stamped as synced,
    // which would drop the contact from the dirty set and strand the admin's
    // local edit (never retrying the push).
    let pushOk = true;
    if (updateFields.length > 0 && currentEtag) {
      try {
        const updated = await people.people.updateContact({
          resourceName,
          updatePersonFields: updateFields.join(","),
          requestBody: { etag: currentEtag, ...updateBody },
        });
        // Refresh etag from the response - the write above changed it.
        googlePerson.etag = updated.data.etag ?? currentEtag;
      } catch (err) {
        console.error(`[google-contacts] updateContact failed for ${resourceName}:`, err);
        pushOk = false;
      }
    }

    // Build the site update from pull actions + the merged phones
    const siteUpdate: Record<string, unknown> = {
      googleContactId: resourceName,
      lastGoogleEtag: googlePerson.etag ?? currentEtag,
    };
    // Only mark the local edit as synced when the push actually succeeded;
    // otherwise leave lastSyncedAt so the dirty-set retries the push next run.
    // lastSyncedAt and updatedAt must be the SAME instant: left to auto-stamp,
    // @updatedAt lands a few ms after this new Date(), so the strict
    // updatedAt > lastSyncedAt dirty check would mark the row dirty again and
    // every run re-pushes the whole contact list until the cron times out.
    if (pushOk) {
      const stampedAt = new Date();
      siteUpdate.lastSyncedAt = stampedAt;
      siteUpdate.updatedAt = stampedAt;
    }
    if (nameAction === "pull" && googleName) siteUpdate.name = googleName;
    // Stored lowercased - the import matches on the lowercased form, so a
    // mixed-case row here comes back as a duplicate on the next pull.
    if (emailAction === "pull" && googleEmail) siteUpdate.email = googleEmail.toLowerCase();
    if (addressAction === "pull" && googleAddress) {
      // Canonicalise the hand-typed Google address before it lands on the site,
      // flagging it for review when it doesn't resolve to one confident match.
      Object.assign(siteUpdate, await addressFields(googleAddress));
    }
    // Keep the site's phone as the first phone in the merged list so the rest
    // of the app (which reads Contact.phone as the primary) sees the primary
    // number, and store the union tail as altPhones so every number the person
    // uses is matchable locally. mergedPhones already unions site primary +
    // alts + Google's list, so a plain set here loses nothing.
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

    // Record / clear conflicts per single-value field
    if (nameAction === "conflict") {
      await recordContactConflict({
        contactId,
        field: "name",
        siteValue: contact.name,
        googleValue: googleName,
      });
    } else {
      await clearContactConflict(contactId, "name");
    }
    if (emailAction === "conflict") {
      await recordContactConflict({
        contactId,
        field: "email",
        siteValue: contact.email,
        googleValue: googleEmail,
      });
    } else {
      await clearContactConflict(contactId, "email");
    }
    if (addressAction === "conflict") {
      await recordContactConflict({
        contactId,
        field: "address",
        siteValue: contact.address,
        googleValue: googleAddress,
      });
    } else {
      await clearContactConflict(contactId, "address");
    }
  } catch (error) {
    console.error(`[google-contacts] syncContactToGoogle failed for ${contactId}:`, error);
  }
}
