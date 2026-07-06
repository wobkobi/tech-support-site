// src/features/contacts/lib/google-contacts.ts
/**
 * @description Google People API bidirectional sync. Phones merge as a union
 * (never overwrite). Single-value fields (name, email, address) are latest-wins
 * via `lastSyncedAt` + `lastGoogleEtag`; if both sides changed and differ, a
 * `ContactConflict` is recorded and the admin resolves it. First-time sync
 * (lastSyncedAt null) lets Google win for any field it has populated.
 */

import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";
import { normaliseAddress } from "@/shared/lib/normalise-address";
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
 * Paginates through all People API connections and upserts each contact by email.
 * Stores the Google resource name as `googleContactId`.
 * @returns The number of contacts imported/upserted.
 */
export async function importFromGoogleContacts(): Promise<number> {
  try {
    const people = getPeopleClient();

    // Build phone > email map from existing Contact rows so phone-only Google
    // contacts can be matched to a known email and imported.
    const contactEmailByPhone = new Map<string, string>();
    const contactRows = await prisma.contact.findMany({
      where: { phone: { not: null }, email: { not: null }, deletedAt: null },
      select: { phone: true, email: true },
    });
    for (const c of contactRows) {
      if (!c.phone || !c.email) continue;
      const norm = normaliseContactPhone(c.phone);
      // Only resolve a phone-only Google contact to an email by a MOBILE match;
      // landlines are often shared, so a landline hit would give the Google
      // contact the wrong person's email (and merge them).
      if (norm && isNZMobileKey(norm) && !contactEmailByPhone.has(norm)) {
        contactEmailByPhone.set(norm, c.email);
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

      // Resolve each Google person to the fields needed, then batch DB lookups
      // for the whole page so each page issues 2 findManys instead of N findFirsts.
      interface Resolved {
        resourceName: string;
        etag: string | null;
        email: string | null;
        phone: string | null;
        normPhone: string | null;
        name: string | null;
        address: string | null;
      }

      const resolved: Resolved[] = [];
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
        const email =
          emailEntry ?? (normPhone ? (contactEmailByPhone.get(normPhone) ?? null) : null);
        const etag = person.etag ?? null;

        resolved.push({ resourceName, etag, email, phone, normPhone, name, address });
      }

      const emailsToCheck = Array.from(
        new Set(resolved.filter((r) => r.email).map((r) => r.email!)),
      );
      const phonesToCheck = Array.from(
        new Set(resolved.filter((r) => !r.email && r.phone).map((r) => r.phone!)),
      );

      interface MatchRow {
        id: string;
        name: string;
        address: string | null;
      }
      const [emailMatches, phoneMatches] = await Promise.all([
        emailsToCheck.length > 0
          ? prisma.contact.findMany({
              where: {
                deletedAt: null,
                OR: [{ email: { in: emailsToCheck } }, { altEmails: { hasSome: emailsToCheck } }],
              },
              select: { id: true, email: true, altEmails: true, name: true, address: true },
            })
          : Promise.resolve([] as (MatchRow & { email: string | null; altEmails: string[] })[]),
        phonesToCheck.length > 0
          ? prisma.contact.findMany({
              where: {
                deletedAt: null,
                OR: [{ phone: { in: phonesToCheck } }, { altPhones: { hasSome: phonesToCheck } }],
              },
              select: { id: true, phone: true, altPhones: true, name: true, address: true },
            })
          : Promise.resolve([] as (MatchRow & { phone: string | null; altPhones: string[] })[]),
      ]);

      // Key the lookup by every address the contact owns that appears in this
      // page (primary + alts), so a Google contact matching an alt email/phone
      // updates the existing record instead of creating a duplicate.
      const emailSet = new Set(emailsToCheck);
      const contactByEmail = new Map<string, MatchRow>();
      for (const c of emailMatches) {
        for (const e of [c.email, ...c.altEmails]) {
          if (e && emailSet.has(e) && !contactByEmail.has(e)) {
            contactByEmail.set(e, { id: c.id, name: c.name, address: c.address });
          }
        }
      }
      const phoneSet = new Set(phonesToCheck);
      const contactByPhone = new Map<string, MatchRow>();
      for (const c of phoneMatches) {
        for (const p of [c.phone, ...c.altPhones]) {
          if (p && phoneSet.has(p) && !contactByPhone.has(p)) {
            contactByPhone.set(p, { id: c.id, name: c.name, address: c.address });
          }
        }
      }

      // Writes stay sequential so a page that contains the same email/phone twice
      // (rare but possible) doesn't race itself into duplicate records. Maps are
      // updated after each create so subsequent iterations see the new row.
      for (const r of resolved) {
        if (r.email) {
          try {
            const existing = contactByEmail.get(r.email);
            if (existing) {
              // First-sync pull: on import, Google's values flow into the
              // site DB (Google wins for any field it has populated). The
              // blank-safety rule means empty Google values never overwrite
              // existing site data. Stamping lastSyncedAt + lastGoogleEtag
              // here is critical: without it the next syncContactToGoogle
              // would see the etag as "changed" and conflict every field.
              const updates: Record<string, unknown> = {
                googleContactId: r.resourceName,
                lastSyncedAt: new Date(),
                lastGoogleEtag: r.etag,
              };
              if (r.name && r.name !== existing.name) updates.name = r.name;
              if (r.phone) updates.phone = r.phone;
              // Canonicalise hand-typed Google addresses, but only when the
              // value actually changed - keeps Geocoding calls near zero on
              // repeat imports.
              if (r.address && r.address !== existing.address) {
                updates.address = (await normaliseAddress(r.address)) ?? r.address;
              }
              await prisma.contact.update({
                where: { id: existing.id },
                data: updates,
              });
            } else {
              const created = await prisma.contact.create({
                data: {
                  name: r.name ?? r.email,
                  email: r.email,
                  phone: r.phone,
                  address: r.address ? ((await normaliseAddress(r.address)) ?? r.address) : null,
                  googleContactId: r.resourceName,
                  lastSyncedAt: new Date(),
                  lastGoogleEtag: r.etag,
                },
                select: { id: true, name: true, address: true },
              });
              contactByEmail.set(r.email, {
                id: created.id,
                name: created.name,
                address: created.address,
              });
            }
            count++;
          } catch (upsertError) {
            console.error(
              `[google-contacts] Failed to import contact (resource ${r.resourceName}):`,
              upsertError,
            );
          }
        } else if (r.normPhone && r.phone) {
          // No email anywhere - create a phone-only contact or link to an existing one.
          try {
            const existing = contactByPhone.get(r.phone);
            if (existing) {
              // Same first-sync pull semantics as the email-matched branch.
              const namePlaceholder = existing.name === r.phone || existing.name === r.normPhone;
              const updates: Record<string, unknown> = {
                googleContactId: r.resourceName,
                lastSyncedAt: new Date(),
                lastGoogleEtag: r.etag,
              };
              // Fill a placeholder name freely, but only let a real Google name
              // OVERWRITE a real local name when matched on a mobile - a name
              // mismatch on a shared landline is likely a different household
              // member, not a rename. Linking the id still avoids duplicates.
              if (
                r.name &&
                (namePlaceholder || (r.name !== existing.name && isNZMobileKey(r.normPhone)))
              ) {
                updates.name = r.name;
              }
              // Same changed-only address canonicalisation as the email branch.
              if (r.address && r.address !== existing.address) {
                updates.address = (await normaliseAddress(r.address)) ?? r.address;
              }
              await prisma.contact.update({
                where: { id: existing.id },
                data: updates,
              });
            } else {
              const created = await prisma.contact.create({
                data: {
                  name: r.name ?? r.phone,
                  email: null,
                  phone: r.phone,
                  address: r.address ? ((await normaliseAddress(r.address)) ?? r.address) : null,
                  googleContactId: r.resourceName,
                  lastSyncedAt: new Date(),
                  lastGoogleEtag: r.etag,
                },
                select: { id: true, name: true, address: true },
              });
              contactByPhone.set(r.phone, {
                id: created.id,
                name: created.name,
                address: created.address,
              });
            }
            count++;
          } catch (importError) {
            console.error(
              `[google-contacts] Failed to import phone-only contact (resource ${r.resourceName}):`,
              importError,
            );
          }
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
          await prisma.contact.update({
            where: { id: contactId },
            data: {
              googleContactId: created.data.resourceName,
              lastSyncedAt: new Date(),
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
    const emailAction = compareSingleField(contact.email, googleEmail, siteChanged, googleChanged);
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
    if (pushOk) siteUpdate.lastSyncedAt = new Date();
    if (nameAction === "pull" && googleName) siteUpdate.name = googleName;
    if (emailAction === "pull" && googleEmail) siteUpdate.email = googleEmail;
    if (addressAction === "pull" && googleAddress) {
      // Canonicalise the hand-typed Google address before it lands on the site.
      siteUpdate.address = (await normaliseAddress(googleAddress)) ?? googleAddress;
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
