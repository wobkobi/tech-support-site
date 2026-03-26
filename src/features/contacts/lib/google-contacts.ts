// src/features/contacts/lib/google-contacts.ts
/**
 * @file google-contacts.ts
 * @description Google People API integration for syncing local contacts with Google Contacts.
 */

import { google } from "googleapis";
import { prisma } from "@/shared/lib/prisma";
import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";

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
    let pageToken: string | undefined;
    let count = 0;

    do {
      const response = await people.people.connections.list({
        resourceName: "people/me",
        personFields: "names,emailAddresses,phoneNumbers,addresses",
        pageSize: 100,
        ...(pageToken ? { pageToken } : {}),
      });

      const connections = response.data.connections ?? [];
      pageToken = response.data.nextPageToken ?? undefined;

      for (const person of connections) {
        const resourceName = person.resourceName;
        if (!resourceName) continue;

        const emailEntry = person.emailAddresses?.[0]?.value;
        if (!emailEntry) continue;

        const email = emailEntry.trim().toLowerCase();
        const name =
          person.names?.[0]?.displayName?.trim() ?? person.names?.[0]?.givenName?.trim() ?? email;
        const phone = person.phoneNumbers?.[0]?.value?.trim() ?? null;
        const addressParts = person.addresses?.[0];
        const address = addressParts?.formattedValue?.trim() ?? null;

        try {
          await prisma.contact.upsert({
            where: { email },
            create: {
              name,
              email,
              phone,
              address,
              googleContactId: resourceName,
            },
            update: {
              name,
              phone,
              address,
              googleContactId: resourceName,
            },
          });
          count++;
        } catch (upsertError) {
          console.error(`[google-contacts] Failed to upsert contact ${email}:`, upsertError);
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
 * Creates or updates a contact in Google Contacts.
 * - If `googleContactId` is provided, updates the existing contact (fetching etag first).
 * - Otherwise searches by email; updates if found, creates if not.
 * Never throws — returns null on any error.
 * @param params - Contact data to sync.
 * @returns The Google People API resource name, or null on error.
 */
export async function upsertToGoogleContacts(params: UpsertContactParams): Promise<string | null> {
  try {
    const people = getPeopleClient();

    const contactBody = {
      names: [{ displayName: params.name }],
      emailAddresses: [{ value: params.email }],
      ...(params.phone ? { phoneNumbers: [{ value: params.phone }] } : {}),
      ...(params.address ? { addresses: [{ formattedValue: params.address }] } : {}),
    };

    // If we already have a resource name, try to update in place.
    if (params.googleContactId) {
      try {
        const existing = await people.people.get({
          resourceName: params.googleContactId,
          personFields: "names,emailAddresses,phoneNumbers,addresses",
        });
        const etag = existing.data.etag;
        if (etag) {
          const updated = await people.people.updateContact({
            resourceName: params.googleContactId,
            updatePersonFields: "names,emailAddresses,phoneNumbers,addresses",
            requestBody: { etag, ...contactBody },
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
            const updated = await people.people.updateContact({
              resourceName,
              updatePersonFields: "names,emailAddresses,phoneNumbers,addresses",
              requestBody: { etag, ...contactBody },
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

    // Create a new contact.
    const created = await people.people.createContact({
      requestBody: contactBody,
    });
    return created.data.resourceName ?? null;
  } catch (error) {
    console.error("[google-contacts] upsertToGoogleContacts failed:", error);
    return null;
  }
}

/**
 * Loads a contact from the local DB and syncs it to Google Contacts.
 * Updates `googleContactId` in the DB if it changed.
 * Never throws — all errors are logged and swallowed.
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
