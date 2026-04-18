import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const connectionsList = vi.fn();
  const get = vi.fn();
  const updateContact = vi.fn();
  const searchContacts = vi.fn();
  const createContact = vi.fn();
  const peopleFactory = vi.fn().mockReturnValue({
    people: {
      connections: { list: connectionsList },
      get,
      updateContact,
      searchContacts,
      createContact,
    },
  });
  const contactUpsert = vi.fn();
  const contactFindMany = vi.fn();
  const contactFindFirst = vi.fn();
  const contactFindUnique = vi.fn();
  const contactUpdate = vi.fn();
  const contactCreate = vi.fn();
  const reviewRequestFindMany = vi.fn();
  return {
    connectionsList,
    get,
    updateContact,
    searchContacts,
    createContact,
    peopleFactory,
    contactUpsert,
    contactFindMany,
    contactFindFirst,
    contactFindUnique,
    contactUpdate,
    contactCreate,
    reviewRequestFindMany,
  };
});

vi.mock("googleapis", () => ({
  google: {
    people: mocks.peopleFactory,
  },
}));

vi.mock("@/features/calendar/lib/google-calendar", () => ({
  getOAuth2Client: vi.fn().mockReturnValue({}),
}));

vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    contact: {
      upsert: mocks.contactUpsert,
      findMany: mocks.contactFindMany,
      findFirst: mocks.contactFindFirst,
      findUnique: mocks.contactFindUnique,
      update: mocks.contactUpdate,
      create: mocks.contactCreate,
    },
    reviewRequest: {
      findMany: mocks.reviewRequestFindMany,
    },
  },
}));

import {
  importFromGoogleContacts,
  upsertToGoogleContacts,
  syncAllContactsToGoogle,
  syncContactToGoogle,
} from "../../src/features/contacts/lib/google-contacts";

describe("importFromGoogleContacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectionsList.mockResolvedValue({
      data: { connections: [], nextPageToken: undefined },
    });
    mocks.contactUpsert.mockResolvedValue({});
    mocks.contactFindFirst.mockResolvedValue(null);
    mocks.contactUpdate.mockResolvedValue({});
    mocks.contactCreate.mockResolvedValue({});
    // Default: no ReviewRequest rows
    mocks.reviewRequestFindMany.mockResolvedValue([]);
  });

  it("returns 0 when the API call throws", async () => {
    mocks.connectionsList.mockRejectedValue(new Error("API Error"));
    const count = await importFromGoogleContacts();
    expect(count).toBe(0);
  });

  it("returns 0 when there are no connections", async () => {
    const count = await importFromGoogleContacts();
    expect(count).toBe(0);
    expect(mocks.contactCreate).not.toHaveBeenCalled();
    expect(mocks.contactUpdate).not.toHaveBeenCalled();
  });

  it("creates each contact and returns the total count", async () => {
    mocks.connectionsList.mockResolvedValue({
      data: {
        connections: [
          {
            resourceName: "people/1",
            names: [{ displayName: "Alice" }],
            emailAddresses: [{ value: "alice@example.com" }],
            phoneNumbers: [{ value: "021 111 2222" }],
            addresses: [{ formattedValue: "1 Main St" }],
          },
          {
            resourceName: "people/2",
            names: [{ displayName: "Bob" }],
            emailAddresses: [{ value: "bob@example.com" }],
          },
        ],
        nextPageToken: undefined,
      },
    });
    const count = await importFromGoogleContacts();
    expect(count).toBe(2);
    expect(mocks.contactCreate).toHaveBeenCalledTimes(2);
    expect(mocks.contactCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "alice@example.com",
        googleContactId: "people/1",
        phone: "+64211112222",
        address: "1 Main St",
      }),
    });
  });

  it("does not overwrite local name, phone, or address for existing contacts", async () => {
    mocks.contactFindFirst.mockResolvedValue({ id: "existing-1" });
    mocks.connectionsList.mockResolvedValue({
      data: {
        connections: [
          {
            resourceName: "people/1",
            names: [{ displayName: "Google Name" }],
            emailAddresses: [{ value: "alice@example.com" }],
            phoneNumbers: [{ value: "000 000 0000" }],
          },
        ],
        nextPageToken: undefined,
      },
    });
    await importFromGoogleContacts();
    // Must update only googleContactId - never name/phone/address
    expect(mocks.contactUpdate).toHaveBeenCalledWith({
      where: { id: "existing-1" },
      data: { googleContactId: "people/1" },
    });
    expect(mocks.contactCreate).not.toHaveBeenCalled();
  });

  it("skips persons without a resourceName", async () => {
    mocks.connectionsList.mockResolvedValue({
      data: {
        connections: [{ emailAddresses: [{ value: "alice@example.com" }] }],
        nextPageToken: undefined,
      },
    });
    const count = await importFromGoogleContacts();
    expect(count).toBe(0);
  });

  it("skips persons with no email and no phone", async () => {
    mocks.connectionsList.mockResolvedValue({
      data: {
        connections: [{ resourceName: "people/1", names: [{ displayName: "No Contact Info" }] }],
        nextPageToken: undefined,
      },
    });
    const count = await importFromGoogleContacts();
    expect(count).toBe(0);
    expect(mocks.contactUpsert).not.toHaveBeenCalled();
    expect(mocks.contactUpdate).not.toHaveBeenCalled();
  });

  it("imports a phone-only Google contact by looking up email in ReviewRequest history", async () => {
    mocks.reviewRequestFindMany.mockResolvedValue([
      { phone: "021 111 2222", email: "carol@example.com" },
    ]);
    mocks.connectionsList.mockResolvedValue({
      data: {
        connections: [
          {
            resourceName: "people/3",
            names: [{ displayName: "Carol" }],
            phoneNumbers: [{ value: "021 111 2222" }],
          },
        ],
        nextPageToken: undefined,
      },
    });
    const count = await importFromGoogleContacts();
    expect(count).toBe(1);
    expect(mocks.contactCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "carol@example.com",
        googleContactId: "people/3",
        name: "Carol",
      }),
    });
  });

  it("links googleContactId by phone when no email is found anywhere", async () => {
    mocks.contactFindFirst.mockResolvedValue({ id: "contact-9" });
    mocks.connectionsList.mockResolvedValue({
      data: {
        connections: [
          {
            resourceName: "people/4",
            names: [{ displayName: "Dave" }],
            phoneNumbers: [{ value: "021 111 2222" }],
          },
        ],
        nextPageToken: undefined,
      },
    });
    const count = await importFromGoogleContacts();
    expect(count).toBe(1);
    expect(mocks.contactUpsert).not.toHaveBeenCalled();
    expect(mocks.contactUpdate).toHaveBeenCalledWith({
      where: { id: "contact-9" },
      data: { googleContactId: "people/4" },
    });
  });

  it("creates a phone-only contact when no ReviewRequest or existing contact matches the phone", async () => {
    mocks.connectionsList.mockResolvedValue({
      data: {
        connections: [
          {
            resourceName: "people/5",
            names: [{ displayName: "Eve" }],
            phoneNumbers: [{ value: "021 999 8888" }],
          },
        ],
        nextPageToken: undefined,
      },
    });
    const count = await importFromGoogleContacts();
    expect(count).toBe(1);
    expect(mocks.contactUpsert).not.toHaveBeenCalled();
    expect(mocks.contactCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Eve",
        email: null,
        phone: "+64219998888",
        googleContactId: "people/5",
      }),
    });
  });

  it("continues processing after a per-contact upsert error", async () => {
    mocks.connectionsList.mockResolvedValue({
      data: {
        connections: [
          {
            resourceName: "people/1",
            names: [{ displayName: "Alice" }],
            emailAddresses: [{ value: "alice@example.com" }],
          },
          {
            resourceName: "people/2",
            names: [{ displayName: "Bob" }],
            emailAddresses: [{ value: "bob@example.com" }],
          },
        ],
        nextPageToken: undefined,
      },
    });
    mocks.contactCreate.mockRejectedValueOnce(new Error("DB error"));
    mocks.contactCreate.mockResolvedValueOnce({});
    const count = await importFromGoogleContacts();
    expect(count).toBe(1);
  });

  it("paginates through all pages", async () => {
    mocks.connectionsList
      .mockResolvedValueOnce({
        data: {
          connections: [
            {
              resourceName: "people/1",
              names: [{ displayName: "Page 1 User" }],
              emailAddresses: [{ value: "page1@example.com" }],
            },
          ],
          nextPageToken: "token-page2",
        },
      })
      .mockResolvedValueOnce({
        data: {
          connections: [
            {
              resourceName: "people/2",
              names: [{ displayName: "Page 2 User" }],
              emailAddresses: [{ value: "page2@example.com" }],
            },
          ],
          nextPageToken: undefined,
        },
      });
    const count = await importFromGoogleContacts();
    expect(count).toBe(2);
    expect(mocks.connectionsList).toHaveBeenCalledTimes(2);
  });

  it("falls back to givenName when displayName is absent", async () => {
    mocks.connectionsList.mockResolvedValue({
      data: {
        connections: [
          {
            resourceName: "people/1",
            names: [{ givenName: "Charlie" }],
            emailAddresses: [{ value: "charlie@example.com" }],
          },
        ],
        nextPageToken: undefined,
      },
    });
    await importFromGoogleContacts();
    expect(mocks.contactCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Charlie" }),
    });
  });
});

describe("upsertToGoogleContacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchContacts.mockResolvedValue({ data: { results: [] } });
    mocks.createContact.mockResolvedValue({ data: { resourceName: "people/created-1" } });
  });

  it("creates a new contact and returns the resource name", async () => {
    const result = await upsertToGoogleContacts({
      name: "Alice",
      email: "alice@example.com",
    });
    expect(result).toBe("people/created-1");
    expect(mocks.createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          names: [{ displayName: "Alice", givenName: "Alice", familyName: "" }],
          emailAddresses: [{ value: "alice@example.com" }],
        }),
      }),
    );
  });

  it("includes phone and address in the contact body when provided", async () => {
    await upsertToGoogleContacts({
      name: "Alice",
      email: "alice@example.com",
      phone: "021 111 2222",
      address: "1 Main St",
    });
    expect(mocks.createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          phoneNumbers: [{ value: "021 111 2222" }],
          addresses: [{ formattedValue: "1 Main St" }],
        }),
      }),
    );
  });

  it("updates an existing contact when googleContactId is provided and it already has a name", async () => {
    mocks.get.mockResolvedValue({
      data: { etag: "etag-abc", names: [{ displayName: "Alice Existing" }] },
    });
    mocks.updateContact.mockResolvedValue({ data: { resourceName: "people/existing-1" } });

    const result = await upsertToGoogleContacts({
      name: "Alice",
      email: "alice@example.com",
      googleContactId: "people/existing-1",
    });
    expect(result).toBe("people/existing-1");
    expect(mocks.updateContact).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceName: "people/existing-1",
        updatePersonFields: "emailAddresses,phoneNumbers,addresses",
        requestBody: expect.objectContaining({ etag: "etag-abc" }),
      }),
    );
    // names must NOT be sent - existing Google name is preserved
    const call = mocks.updateContact.mock.calls[0][0] as { requestBody: Record<string, unknown> };
    expect(call.requestBody).not.toHaveProperty("names");
    expect(mocks.searchContacts).not.toHaveBeenCalled();
  });

  it("sets the name when updating a contact that has no name in Google", async () => {
    mocks.get.mockResolvedValue({ data: { etag: "etag-noname", names: [] } });
    mocks.updateContact.mockResolvedValue({ data: { resourceName: "people/existing-2" } });

    const result = await upsertToGoogleContacts({
      name: "Alice",
      email: "alice@example.com",
      googleContactId: "people/existing-2",
    });
    expect(result).toBe("people/existing-2");
    expect(mocks.updateContact).toHaveBeenCalledWith(
      expect.objectContaining({
        updatePersonFields: "names,emailAddresses,phoneNumbers,addresses",
        requestBody: expect.objectContaining({
          etag: "etag-noname",
          names: [{ displayName: "Alice", givenName: "Alice", familyName: "" }],
        }),
      }),
    );
  });

  it("falls back to search when fetching the existing resource fails", async () => {
    mocks.get.mockRejectedValue(new Error("Not found"));

    const result = await upsertToGoogleContacts({
      name: "Alice",
      email: "alice@example.com",
      googleContactId: "people/gone-1",
    });
    expect(mocks.searchContacts).toHaveBeenCalled();
    expect(result).toBe("people/created-1");
  });

  it("updates a contact found by search (has existing name - name not replaced)", async () => {
    mocks.searchContacts.mockResolvedValue({
      data: {
        results: [
          {
            person: {
              resourceName: "people/found-1",
              emailAddresses: [{ value: "alice@example.com" }],
            },
          },
        ],
      },
    });
    mocks.get.mockResolvedValue({
      data: { etag: "etag-found", names: [{ displayName: "Alice Full Name" }] },
    });
    mocks.updateContact.mockResolvedValue({ data: { resourceName: "people/found-1" } });

    const result = await upsertToGoogleContacts({
      name: "Alice",
      email: "alice@example.com",
    });
    expect(result).toBe("people/found-1");
    expect(mocks.updateContact).toHaveBeenCalledWith(
      expect.objectContaining({
        updatePersonFields: "emailAddresses,phoneNumbers,addresses",
      }),
    );
    // names must NOT be sent - existing Google name is preserved
    const call = mocks.updateContact.mock.calls[0][0] as { requestBody: Record<string, unknown> };
    expect(call.requestBody).not.toHaveProperty("names");
    expect(mocks.createContact).not.toHaveBeenCalled();
  });

  it("sets the name when updating a contact found by search that has no name", async () => {
    mocks.searchContacts.mockResolvedValue({
      data: {
        results: [
          {
            person: {
              resourceName: "people/found-2",
              emailAddresses: [{ value: "alice@example.com" }],
            },
          },
        ],
      },
    });
    mocks.get.mockResolvedValue({ data: { etag: "etag-found-noname", names: [] } });
    mocks.updateContact.mockResolvedValue({ data: { resourceName: "people/found-2" } });

    const result = await upsertToGoogleContacts({
      name: "Alice",
      email: "alice@example.com",
    });
    expect(result).toBe("people/found-2");
    expect(mocks.updateContact).toHaveBeenCalledWith(
      expect.objectContaining({
        updatePersonFields: "names,emailAddresses,phoneNumbers,addresses",
        requestBody: expect.objectContaining({
          names: [{ displayName: "Alice", givenName: "Alice", familyName: "" }],
        }),
      }),
    );
    expect(mocks.createContact).not.toHaveBeenCalled();
  });

  it("creates when search errors out", async () => {
    mocks.searchContacts.mockRejectedValue(new Error("Search API down"));

    const result = await upsertToGoogleContacts({
      name: "Alice",
      email: "alice@example.com",
    });
    expect(result).toBe("people/created-1");
    expect(mocks.createContact).toHaveBeenCalled();
  });

  it("returns null when the outer call throws", async () => {
    mocks.searchContacts.mockRejectedValue(new Error("Search failed"));
    mocks.createContact.mockRejectedValue(new Error("Create also failed"));

    const result = await upsertToGoogleContacts({
      name: "Alice",
      email: "alice@example.com",
    });
    expect(result).toBeNull();
  });
});

describe("syncAllContactsToGoogle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contactFindMany.mockResolvedValue([]);
    mocks.contactFindUnique.mockResolvedValue(null);
    mocks.searchContacts.mockResolvedValue({ data: { results: [] } });
    mocks.createContact.mockResolvedValue({ data: { resourceName: "people/1" } });
    mocks.contactUpdate.mockResolvedValue({});
  });

  it("returns 0 when there are no contacts in the DB", async () => {
    const count = await syncAllContactsToGoogle();
    expect(count).toBe(0);
  });

  it("returns the number of contacts processed", async () => {
    mocks.contactFindMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    mocks.contactFindUnique.mockResolvedValue({
      id: "c1",
      name: "Alice",
      email: "alice@example.com",
      phone: null,
      address: null,
      googleContactId: null,
    });
    const count = await syncAllContactsToGoogle();
    expect(count).toBe(2);
  });
});

describe("syncContactToGoogle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contactFindUnique.mockResolvedValue(null);
    mocks.searchContacts.mockResolvedValue({ data: { results: [] } });
    mocks.createContact.mockResolvedValue({ data: { resourceName: "people/new-1" } });
    mocks.contactUpdate.mockResolvedValue({});
  });

  it("returns without error when the contact does not exist in the DB", async () => {
    await expect(syncContactToGoogle("nonexistent")).resolves.toBeUndefined();
    expect(mocks.contactUpdate).not.toHaveBeenCalled();
  });

  it("updates googleContactId in the DB when the resource name changes", async () => {
    mocks.contactFindUnique.mockResolvedValue({
      id: "c1",
      name: "Alice",
      email: "alice@example.com",
      phone: null,
      address: null,
      googleContactId: "people/old-1",
    });
    mocks.get.mockResolvedValue({ data: { etag: "etag-1" } });
    mocks.updateContact.mockResolvedValue({ data: { resourceName: "people/new-1" } });

    await syncContactToGoogle("c1");

    expect(mocks.contactUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { googleContactId: "people/new-1" },
    });
  });

  it("does not update the DB when the googleContactId is unchanged", async () => {
    mocks.contactFindUnique.mockResolvedValue({
      id: "c1",
      name: "Alice",
      email: "alice@example.com",
      phone: null,
      address: null,
      googleContactId: "people/same-1",
    });
    mocks.get.mockResolvedValue({ data: { etag: "etag-1" } });
    mocks.updateContact.mockResolvedValue({ data: { resourceName: "people/same-1" } });

    await syncContactToGoogle("c1");

    expect(mocks.contactUpdate).not.toHaveBeenCalled();
  });

  it("swallows errors without throwing", async () => {
    mocks.contactFindUnique.mockRejectedValue(new Error("DB error"));
    await expect(syncContactToGoogle("c1")).resolves.toBeUndefined();
  });

  it("upserts contact to google and updates DB for a contact with no existing googleContactId", async () => {
    mocks.contactFindUnique.mockResolvedValue({
      id: "c2",
      name: "Bob",
      email: "bob@example.com",
      phone: "021 222 3333",
      address: "2 Test St",
      googleContactId: null,
    });

    await syncContactToGoogle("c2");

    expect(mocks.searchContacts).toHaveBeenCalledWith(
      expect.objectContaining({ query: "bob@example.com" }),
    );
    expect(mocks.contactUpdate).toHaveBeenCalledWith({
      where: { id: "c2" },
      data: { googleContactId: "people/new-1" },
    });
  });
});
