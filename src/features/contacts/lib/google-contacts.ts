// src/features/contacts/lib/google-contacts.ts
/**
 * @file google-contacts.ts
 * @description Google People API integration for syncing local contacts with Google Contacts.
 */

import { google } from "googleapis";
import { prisma } from "@/shared/lib/prisma";
import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";
import { normalizePhone, toE164NZ } from "@/shared/lib/normalize-phone";

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

    // Build phone → email map from ReviewRequest history so phone-only Google
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

        // Resolve email: direct from Google, or looked up via phone in ReviewRequest history.
        const email =
          emailEntry ?? (normPhone ? (reviewRequestsByPhone.get(normPhone) ?? null) : null);

        if (email) {
          try {
            const existing = await prisma.contact.findFirst({ where: { email } });
            if (existing) {
              await prisma.contact.update({
                where: { id: existing.id },
                // Local name/phone/address are the source of truth - only link the resource name.
                data: { googleContactId: resourceName },
              });
            } else {
              await prisma.contact.create({
                data: { name: name ?? email, email, phone, address, googleContactId: resourceName },
              });
            }
            count++;
          } catch (upsertError) {
            console.error(
              `[google-contacts] Failed to import contact (resource ${resourceName}):`,
              upsertError,
            );
          }
        } else if (normPhone) {
          // No email anywhere - create a phone-only contact or link to an existing one.
          try {
            const existing = await prisma.contact.findFirst({
              where: { phone },
              select: { id: true, name: true },
            });
            if (existing) {
              // Also update the name if it was set to the phone number as a placeholder.
              const namePlaceholder = existing.name === phone || existing.name === normPhone;
              await prisma.contact.update({
                where: { id: existing.id },
                data: {
                  googleContactId: resourceName,
                  ...(name && namePlaceholder ? { name } : {}),
                },
              });
            } else {
              await prisma.contact.create({
                data: {
                  name: name ?? phone!,
                  email: null,
                  phone,
                  address,
                  googleContactId: resourceName,
                },
              });
            }
            count++;
          } catch (importError) {
            console.error(
              `[google-contacts] Failed to import phone-only contact ${normPhone}:`,
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
 * Parameters for upserting a contact to Google Contacts.
 */
export interface UpsertContactParams {
  /** Full display name. */
  name: string;
  /** Email address (used for deduplication). */
  email: string;
  /** Phone number, or null. */
  phone?: string | null;
  /** Street/postal address, or null. */
  address?: string | null;
  /** Existing Google People API resource name if known (e.g. "people/c1234567890"). */
  googleContactId?: string | null;
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
 * Creates or updates a contact in Google Contacts.
 * - If `googleContactId` is provided, updates the existing contact (fetching etag first).
 * - Otherwise searches by email; updates if found, creates if not.
 * Never throws - returns null on any error.
 * @param params - Contact data to sync.
 * @returns The Google People API resource name, or null on error.
 */
export async function upsertToGoogleContacts(params: UpsertContactParams): Promise<string | null> {
  try {
    const people = getPeopleClient();

    const { givenName, familyName } = splitName(params.name);

    // Full body used only when CREATING a new contact - includes the local name.
    const createBody = {
      names: [{ displayName: params.name, givenName, familyName }],
      emailAddresses: [{ value: params.email }],
      ...(params.phone ? { phoneNumbers: [{ value: params.phone }] } : {}),
      ...(params.address ? { addresses: [{ formattedValue: params.address }] } : {}),
    };

    // Base update fields - always sync email, phone, address.
    // `names` is added only when the existing Google contact has no name.
    const baseUpdateBody = {
      emailAddresses: [{ value: params.email }],
      ...(params.phone ? { phoneNumbers: [{ value: params.phone }] } : {}),
      ...(params.address ? { addresses: [{ formattedValue: params.address }] } : {}),
    };

    /**
     * Builds the request body and personFields for an update, adding `names`
     * only when the existing Google contact has no display name.
     * @param existingNames - The `names` array from the fetched Google contact.
     * @returns Body and personFields string to pass to updateContact.
     */
    function buildUpdate(
      existingNames: Array<{ displayName?: string | null }> | null | undefined,
    ): {
      body: typeof baseUpdateBody & {
        names?: Array<{ displayName: string; givenName: string; familyName: string }>;
      };
      fields: string;
    } {
      const hasName = existingNames?.some((n) => n.displayName?.trim());
      if (!hasName && params.name) {
        return {
          body: { names: [{ displayName: params.name, givenName, familyName }], ...baseUpdateBody },
          fields: "names,emailAddresses,phoneNumbers,addresses",
        };
      }
      return { body: baseUpdateBody, fields: "emailAddresses,phoneNumbers,addresses" };
    }

    // If we already have a resource name, try to update in place.
    if (params.googleContactId) {
      try {
        const existing = await people.people.get({
          resourceName: params.googleContactId,
          personFields: "names,emailAddresses,phoneNumbers,addresses",
        });
        const etag = existing.data.etag;
        if (etag) {
          const { body, fields } = buildUpdate(existing.data.names);
          const updated = await people.people.updateContact({
            resourceName: params.googleContactId,
            updatePersonFields: fields,
            requestBody: { etag, ...body },
          });
          return updated.data.resourceName ?? params.googleContactId;
        }
      } catch (updateError) {
        // Fall through to search-and-create if the existing resource is gone.
        console.error(
          `[google-contacts] Failed to update ${params.googleContactId}, falling back to search:`,
          updateError,
        );
      }
    }

    // Search for an existing contact by email.
    try {
      const searchResult = await people.people.searchContacts({
        query: params.email,
        readMask: "names,emailAddresses",
        pageSize: 5,
      });

      const match = searchResult.data.results?.find((r) =>
        r.person?.emailAddresses?.some(
          (e) => e.value?.toLowerCase() === params.email.toLowerCase(),
        ),
      );

      if (match?.person?.resourceName) {
        const resourceName = match.person.resourceName;
        try {
          const existing = await people.people.get({
            resourceName,
            personFields: "names,emailAddresses,phoneNumbers,addresses",
          });
          const etag = existing.data.etag;
          if (etag) {
            const { body, fields } = buildUpdate(existing.data.names);
            const updated = await people.people.updateContact({
              resourceName,
              updatePersonFields: fields,
              requestBody: { etag, ...body },
            });
            return updated.data.resourceName ?? resourceName;
          }
        } catch (updateFoundError) {
          console.error(
            `[google-contacts] Failed to update found contact ${resourceName}:`,
            updateFoundError,
          );
          return resourceName;
        }
      }
    } catch (searchError) {
      console.error("[google-contacts] Search failed, will attempt create:", searchError);
    }

    // Create a new contact - use the full body including name.
    const created = await people.people.createContact({
      requestBody: createBody,
    });
    return created.data.resourceName ?? null;
  } catch (error) {
    console.error("[google-contacts] upsertToGoogleContacts failed:", error);
    return null;
  }
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
 * Loads a contact from the local DB and syncs it to Google Contacts.
 * Updates `googleContactId` in the DB if it changed.
 * Never throws - all errors are logged and swallowed.
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

    const resourceName = await upsertToGoogleContacts({
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      address: contact.address,
      googleContactId: contact.googleContactId,
    });

    if (resourceName && resourceName !== contact.googleContactId) {
      await prisma.contact.update({
        where: { id: contactId },
        data: { googleContactId: resourceName },
      });
    }
  } catch (error) {
    console.error(`[google-contacts] syncContactToGoogle failed for ${contactId}:`, error);
  }
}
