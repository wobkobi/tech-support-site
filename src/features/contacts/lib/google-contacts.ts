// src/features/contacts/lib/google-contacts.ts
/**
 * @file google-contacts.ts
 * @description Google People API integration with bidirectional latest-wins
 * sync. The site DB and Google Contacts both have authority, with conflict
 * resolution:
 *
 * - Phones: always merged as a union. A second number from a new booking is
 *   appended to Google's existing phones; nothing is ever overwritten.
 * - Names, emails, addresses (single-value fields): latest-wins when only one
 *   side changed since the last sync (using Contact.lastSyncedAt and the
 *   stored Google etag in lastGoogleEtag to detect change). When BOTH sides
 *   changed and values differ, a ContactConflict row is recorded and the
 *   admin resolves it from /admin/contacts/conflicts. The site DB is not
 *   updated until the admin picks a winner.
 *
 * On first contact (lastSyncedAt null), Google's values win for any field
 * Google has populated, with site values used to fill remaining blanks.
 */

import { google } from "googleapis";
import { prisma } from "@/shared/lib/prisma";
import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";
import { normalizePhone, toE164NZ } from "@/shared/lib/normalize-phone";
import { recordContactConflict, clearContactConflict } from "./contact-conflicts";

/**
 * Returns an authenticated Google People API client.
 * @returns People API instance.
 */
function getPeopleClient(): ReturnType<typeof google.people> {
  const auth = getOAuth2Client();
  return google.people({ version: "v1", auth });
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

    // Build phone > email map from ReviewRequest history so phone-only Google
    // contacts can be matched to a known email and imported.
    const reviewRequestsByPhone = new Map<string, string>();
    const rrRows = await prisma.reviewRequest.findMany({
      where: { phone: { not: null }, email: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { phone: true, email: true },
    });
    for (const rr of rrRows) {
      if (!rr.phone || !rr.email) continue;
      const norm = normalizePhone(toE164NZ(rr.phone) || rr.phone);
      if (norm && !reviewRequestsByPhone.has(norm)) reviewRequestsByPhone.set(norm, rr.email);
    }

    let pageToken: string | undefined;
    let count = 0;

    do {
      const response = await people.people.connections.list({
        resourceName: "people/me",
        personFields: "names,emailAddresses,phoneNumbers,addresses,organizations",
        pageSize: 100,
        ...(pageToken ? { pageToken } : {}),
      });

      const connections = response.data.connections ?? [];
      pageToken = response.data.nextPageToken ?? undefined;

      // Resolve each Google person to the fields we need, then batch DB lookups
      // for the whole page so we issue 2 findManys instead of N findFirsts.
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
        const normPhone = rawPhone ? normalizePhone(toE164NZ(rawPhone) || rawPhone) : null;
        const name =
          person.names?.[0]?.displayName?.trim() ??
          person.names?.[0]?.givenName?.trim() ??
          person.organizations?.[0]?.name?.trim() ??
          null;
        const address = person.addresses?.[0]?.formattedValue?.trim() ?? null;
        const email =
          emailEntry ?? (normPhone ? (reviewRequestsByPhone.get(normPhone) ?? null) : null);
        const etag = person.etag ?? null;

        resolved.push({ resourceName, etag, email, phone, normPhone, name, address });
      }

      const emailsToCheck = Array.from(
        new Set(resolved.filter((r) => r.email).map((r) => r.email!)),
      );
      const phonesToCheck = Array.from(
        new Set(resolved.filter((r) => !r.email && r.phone).map((r) => r.phone!)),
      );

      const [emailMatches, phoneMatches] = await Promise.all([
        emailsToCheck.length > 0
          ? prisma.contact.findMany({
              where: { email: { in: emailsToCheck } },
              select: { id: true, email: true, name: true },
            })
          : Promise.resolve([] as { id: string; email: string | null; name: string }[]),
        phonesToCheck.length > 0
          ? prisma.contact.findMany({
              where: { phone: { in: phonesToCheck } },
              select: { id: true, phone: true, name: true },
            })
          : Promise.resolve([] as { id: string; phone: string | null; name: string }[]),
      ]);

      const contactByEmail = new Map<string, { id: string; name: string }>();
      for (const c of emailMatches) {
        if (c.email) contactByEmail.set(c.email, { id: c.id, name: c.name });
      }
      const contactByPhone = new Map<string, { id: string; name: string }>();
      for (const c of phoneMatches) {
        if (c.phone) contactByPhone.set(c.phone, { id: c.id, name: c.name });
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
              if (r.address) updates.address = r.address;
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
                  address: r.address,
                  googleContactId: r.resourceName,
                  lastSyncedAt: new Date(),
                  lastGoogleEtag: r.etag,
                },
                select: { id: true, name: true },
              });
              contactByEmail.set(r.email, { id: created.id, name: created.name });
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
              if (r.name && (namePlaceholder || r.name !== existing.name)) updates.name = r.name;
              if (r.address) updates.address = r.address;
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
                  address: r.address,
                  googleContactId: r.resourceName,
                  lastSyncedAt: new Date(),
                  lastGoogleEtag: r.etag,
                },
                select: { id: true, name: true },
              });
              contactByPhone.set(r.phone, { id: created.id, name: created.name });
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
 * Splits a full display name into given (first) and family (last) name parts.
 * @param fullName - Full display name.
 * @returns Object with givenName and familyName strings.
 */
function splitName(fullName: string): { givenName: string; familyName: string } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { givenName: "", familyName: "" };
  if (parts.length === 1) return { givenName: parts[0], familyName: "" };
  return { givenName: parts.slice(0, -1).join(" "), familyName: parts[parts.length - 1] };
}

/**
 * Pushes every local contact to Google Contacts and returns the number synced.
 * Errors on individual contacts are logged and skipped.
 * @returns Number of contacts successfully synced.
 */
export async function syncAllContactsToGoogle(): Promise<number> {
  const contacts = await prisma.contact.findMany({ select: { id: true } });
  let count = 0;
  for (const { id } of contacts) {
    try {
      await syncContactToGoogle(id);
      count++;
    } catch (err) {
      console.error(`[google-contacts] syncAllContactsToGoogle: failed for ${id}:`, err);
    }
  }
  return count;
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
 * @param sitePhone - Site's single phone field (may be null).
 * @param googlePhones - All values from Google's phoneNumbers array.
 * @returns Merged phone array suitable for pushing back to Google.
 */
function mergePhones(sitePhone: string | null, googlePhones: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of googlePhones) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    const key = normalizePhone(toE164NZ(trimmed) || trimmed) ?? trimmed;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  if (sitePhone?.trim()) {
    const trimmed = sitePhone.trim();
    const key = normalizePhone(toE164NZ(trimmed) || trimmed) ?? trimmed;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

/**
 * Bidirectional sync between a site Contact and its Google Contacts counterpart.
 *
 * Loads the contact, finds (or creates) the matching Google person, then:
 * - merges phones as a union so booking-time phone variations are appended,
 *   never lost,
 * - for name / email / address, uses latest-wins when only one side changed
 *   since the last sync (Contact.lastSyncedAt vs Google's etag); when both
 *   sides changed and values diverge, records a ContactConflict for admin
 *   approval and leaves the site value alone.
 *
 * Stamps Contact.lastSyncedAt + Contact.lastGoogleEtag on success so the next
 * sync can detect change correctly. Never throws - all errors are logged.
 * @param contactId - The local DB contact ID to sync.
 * @returns Promise that resolves when the sync attempt is complete.
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
    const mergedPhones = mergePhones(contact.phone, googlePhoneList);
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

    if (updateFields.length > 0 && currentEtag) {
      try {
        const updated = await people.people.updateContact({
          resourceName,
          updatePersonFields: updateFields.join(","),
          requestBody: { etag: currentEtag, ...updateBody },
        });
        // Refresh etag from the response - it changed because we just wrote.
        googlePerson.etag = updated.data.etag ?? currentEtag;
      } catch (err) {
        console.error(`[google-contacts] updateContact failed for ${resourceName}:`, err);
      }
    }

    // Build the site update from pull actions + the merged phones
    const siteUpdate: Record<string, unknown> = {
      googleContactId: resourceName,
      lastSyncedAt: new Date(),
      lastGoogleEtag: googlePerson.etag ?? currentEtag,
    };
    if (nameAction === "pull" && googleName) siteUpdate.name = googleName;
    if (emailAction === "pull" && googleEmail) siteUpdate.email = googleEmail;
    if (addressAction === "pull" && googleAddress) siteUpdate.address = googleAddress;
    // Keep the site's phone as the first phone in the merged list so the rest
    // of the app (which only reads the single Contact.phone field) sees the
    // primary number.
    if (mergedPhones[0] && mergedPhones[0] !== contact.phone) {
      siteUpdate.phone = mergedPhones[0];
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
