// src/features/business/lib/invoice-recipient.ts
// Whether an invoice went to a person or to their company. Invoice.clientName holds whichever
// name the operator addressed it to, so "68 Ltd" on Michael Smith's linked contact means it went
// to his company - and the emails should still greet Michael, not "68".

import { looksLikeBusinessName } from "@/features/business/lib/payment-fields";

/** The linked Contact fields the check reads. */
export interface RecipientContact {
  name: string;
  company: string | null;
}

/** Who an invoice is addressed to. */
export interface InvoiceRecipient {
  /** True when the invoice is addressed to the contact's business rather than to them. */
  toCompany: boolean;
  /** The person behind a company invoice (the linked contact's name); null otherwise. */
  attention: string | null;
  /** First name the invoice emails greet by default. */
  greetingName: string;
}

/**
 * Reduces a name to a form two spellings can agree on ("68 LTD." vs "68 Ltd").
 * @param name - Raw name.
 * @returns Lowercased, punctuation-free, single-spaced form.
 */
function comparable(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * First word of a name, or the whole trimmed name when it has none.
 * @param name - Raw name.
 * @returns First name.
 */
function firstWord(name: string): string {
  const trimmed = name.trim();
  return trimmed.split(/\s+/)[0] || trimmed;
}

/**
 * Works out whether an invoice is addressed to the linked contact's company. It is when the
 * client name matches the contact's stored company, or - for contacts whose company isn't on
 * file - when the name differs from the contact's and reads as a business ("Acme Plumbing Ltd").
 * A differing name that doesn't read as one ("Mike" on Michael Smith) is treated as the person.
 * @param clientName - The name the invoice is addressed to.
 * @param contact - The linked contact, or null when the invoice has none.
 * @returns Company flag, the person to mark it for the attention of, and who to greet.
 */
export function invoiceRecipient(
  clientName: string,
  contact: RecipientContact | null,
): InvoiceRecipient {
  const asPerson: InvoiceRecipient = {
    toCompany: false,
    attention: null,
    greetingName: firstWord(clientName),
  };
  const person = contact?.name.trim();
  if (!contact || !person) return asPerson;

  const client = comparable(clientName);
  const matchesCompany = !!contact.company && comparable(contact.company) === client;
  const namedDifferently = comparable(person) !== client;
  if (!matchesCompany && !(namedDifferently && looksLikeBusinessName(clientName))) return asPerson;
  // A contact saved under the company name itself has no person to greet.
  if (!namedDifferently || looksLikeBusinessName(person)) return asPerson;

  return { toCompany: true, attention: person, greetingName: firstWord(person) };
}
