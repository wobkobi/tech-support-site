// src/features/mailing/lib/resend-marketing.ts
// Resend's Marketing side (contacts, segments, imports, broadcasts) on its own full-access
// key. Broadcasts don't count toward the transactional daily limit that booking, invoice
// and review emails share. Every call is paced and throws with Resend's own message.

import { Resend } from "resend";

/** Gap between calls: Resend allows 10 requests a second per team, shared with booking emails. */
const CALL_GAP_MS = 110;

let client: Resend | null = null;
let nextCallAt = 0;

/**
 * Whether the marketing key is set, so mailing-list sends go out as broadcasts.
 * @returns True when RESEND_MARKETING_API_KEY is set.
 */
export function marketingReady(): boolean {
  return Boolean(process.env.RESEND_MARKETING_API_KEY?.trim());
}

/**
 * The marketing client, created on first use so importing never throws without the key.
 * @returns Resend client on the marketing key.
 */
function marketing(): Resend {
  client ??= new Resend(process.env.RESEND_MARKETING_API_KEY?.trim());
  return client;
}

/**
 * Runs one Resend call after the pacing gap and unwraps its `{ data, error }` answer.
 * @param label - What the call does, for the error message.
 * @param call - The call, given the client.
 * @returns The call's data.
 */
async function paced<T>(
  label: string,
  call: (resend: Resend) => Promise<{ data: T | null; error: { message: string } | null }>,
): Promise<T> {
  const wait = nextCallAt - Date.now();
  nextCallAt = Math.max(Date.now(), nextCallAt) + CALL_GAP_MS;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  const { data, error } = await call(marketing());
  if (error || !data) throw new Error(`Resend couldn't ${label}: ${error?.message ?? "no answer"}`);
  return data;
}

/** One contact as Resend holds it. */
export interface MarketingContact {
  id: string;
  email: string;
  unsubscribed: boolean;
}

/**
 * Every contact on the Resend account, 100 a page.
 * @returns The contacts.
 */
export async function listMarketingContacts(): Promise<MarketingContact[]> {
  const out: MarketingContact[] = [];
  let after: string | undefined;
  // 20 pages is 2,000 contacts, twice the free plan's cap.
  for (let page = 0; page < 20; page++) {
    const data = await paced("list contacts", (r) =>
      r.contacts.list(after ? { limit: 100, after } : { limit: 100 }),
    );
    for (const c of data.data) {
      out.push({ id: c.id, email: c.email.toLowerCase(), unsubscribed: c.unsubscribed });
    }
    const last = data.data.at(-1);
    if (!data.has_more || !last) break;
    after = last.id;
  }
  return out;
}

/**
 * Deletes one contact.
 * @param id - Resend contact id.
 */
export async function removeMarketingContact(id: string): Promise<void> {
  await paced("remove a contact", (r) => r.contacts.remove(id));
}

/**
 * Creates any of the given string properties the account doesn't have yet.
 * @param keys - Property keys the import and the merge tags use.
 */
export async function ensureContactProperties(keys: readonly string[]): Promise<void> {
  const existing = await paced("list contact properties", (r) =>
    r.contactProperties.list({ limit: 100 }),
  );
  const have = new Set(existing.data.map((p) => p.key));
  for (const key of keys) {
    if (have.has(key)) continue;
    await paced(`add the ${key} property`, (r) =>
      r.contactProperties.create({ key, type: "string", fallbackValue: "" }),
    );
  }
}

/**
 * Every segment on the account.
 * @returns Segment ids and names.
 */
export async function listSegments(): Promise<{ id: string; name: string }[]> {
  const data = await paced("list segments", (r) => r.segments.list({ limit: 100 }));
  return data.data.map((s) => ({ id: s.id, name: s.name }));
}

/**
 * Creates a segment.
 * @param name - Segment name, shown in Resend's dashboard.
 * @returns The new segment's id.
 */
export async function createSegment(name: string): Promise<string> {
  return (await paced("make a segment", (r) => r.segments.create({ name }))).id;
}

/**
 * Deletes a segment; its contacts stay on the account.
 * @param id - Segment id.
 */
export async function removeSegment(id: string): Promise<void> {
  await paced("remove a segment", (r) => r.segments.remove(id));
}

/**
 * Starts a CSV contact import into a segment. Existing contacts are updated in place,
 * and their unsubscribed state is left alone (the CSV has no such column).
 * @param csv - The CSV text, header row first.
 * @param columns - Custom property keys, each also its column's header.
 * @param segmentId - Segment every imported contact joins.
 * @returns The import's id.
 */
export async function startContactImport(
  csv: string,
  columns: readonly string[],
  segmentId: string,
): Promise<string> {
  const properties = Object.fromEntries(
    columns.map((key) => [key, { column: key, type: "string" as const }]),
  );
  const data = await paced("load the list", (r) =>
    r.contacts.imports.create({
      file: new Blob([csv], { type: "text/csv" }),
      columnMap: { email: "email", firstName: "first_name", lastName: "last_name", properties },
      onConflict: "upsert",
      segments: [{ id: segmentId }],
    }),
  );
  return data.id;
}

/**
 * Where a contact import has got to.
 * @param id - Import id.
 * @returns Its status and how many rows failed.
 */
export async function contactImportStatus(
  id: string,
): Promise<{ status: "queued" | "in_progress" | "completed" | "failed"; failed: number }> {
  const data = await paced("check the list upload", (r) => r.contacts.imports.get(id));
  return { status: data.status, failed: data.counts.failed };
}

/** What a broadcast is made of. */
export interface BroadcastDraft {
  name: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  segmentId: string;
}

/**
 * Creates a broadcast as a draft, so its id can be stored before anything sends.
 * @param draft - Sender, content and segment.
 * @returns The broadcast's id.
 */
export async function createBroadcast(draft: BroadcastDraft): Promise<string> {
  const data = await paced("make the broadcast", (r) => r.broadcasts.create({ ...draft }));
  return data.id;
}

/**
 * Sends a draft broadcast now.
 * @param id - Broadcast id.
 */
export async function sendBroadcast(id: string): Promise<void> {
  await paced("send the broadcast", (r) => r.broadcasts.send(id));
}

/**
 * A broadcast's status.
 * @param id - Broadcast id.
 * @returns "draft" until it's sent, then "queued" and "sent".
 */
export async function broadcastStatus(id: string): Promise<"draft" | "queued" | "sent"> {
  return (await paced("check the broadcast", (r) => r.broadcasts.get(id))).status;
}

/**
 * Deletes a draft broadcast, used when two runs raced and one draft is spare.
 * @param id - Broadcast id.
 */
export async function removeBroadcast(id: string): Promise<void> {
  await paced("remove a spare broadcast", (r) => r.broadcasts.remove(id));
}
