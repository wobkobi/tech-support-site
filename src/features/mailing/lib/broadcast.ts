// src/features/mailing/lib/broadcast.ts
// Pure pieces of a Resend broadcast send: the merge tags Resend fills per person, the
// contact CSV that carries their values, and the resume rule for the send call.

/** Custom contact properties a broadcast reads, each also its CSV column's header. */
export const BROADCAST_PROPERTIES = ["full_name", "review_text", "unsubscribe_url"] as const;

/**
 * Resend's per-person merge tags, standing in for the placeholders a batch send fills
 * itself. `|there` is Resend's fallback for a blank value.
 */
export const MERGE_TAG = {
  firstName: "{{{contact.first_name|there}}}",
  name: "{{{contact.full_name|there}}}",
  reviewText: "{{{contact.review_text}}}",
  unsubscribeUrl: "{{{contact.unsubscribe_url}}}",
} as const;

/** How long a claimed send call is left alone before a resumed run may try it again. */
export const SEND_CLAIM_GRACE_MS = 3 * 60_000;

/** One person's row in the import. */
export interface ImportRow {
  email: string;
  name: string | null;
  reviewText: string | null;
  unsubscribeUrl: string;
}

/**
 * First word, and the rest, of a stored name.
 * @param name - Contact name, or null.
 * @returns The two parts, "" when missing.
 */
export function splitName(name: string | null): { first: string; last: string } {
  const [first = "", ...rest] = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  return { first, last: rest.join(" ") };
}

/**
 * A value as Resend should insert it. White space collapses to single spaces, as the HTML
 * shows it anyway, and `<` `>` go, so a review can't open a tag in the HTML part.
 * @param value - Raw value.
 * @returns The cleaned value.
 */
export function mergeValue(value: string | null): string {
  return (value ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Quotes one CSV cell. No formula guard (unlike the spreadsheet export): Resend reads the
 * text exactly, so an apostrophe would end up in the name.
 * @param value - Cell text.
 * @returns The quoted cell.
 */
function cell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * The import CSV: Resend's own name columns plus {@link BROADCAST_PROPERTIES}.
 * @param rows - One row per pending recipient.
 * @returns CSV text, header row first.
 */
export function importCsv(rows: ImportRow[]): string {
  const header = ["email", "first_name", "last_name", ...BROADCAST_PROPERTIES];
  const lines = rows.map((row) => {
    const { first, last } = splitName(mergeValue(row.name));
    return [
      row.email,
      first,
      last,
      mergeValue(row.name),
      mergeValue(row.reviewText),
      row.unsubscribeUrl,
    ]
      .map(cell)
      .join(",");
  });
  return [header.join(","), ...lines].join("\n");
}

/**
 * What a run does about the call that sends the broadcast.
 * - Resend says queued or sent: it has gone, never call again.
 * - Still a draft and unclaimed: send it.
 * - Still a draft but claimed within {@link SEND_CLAIM_GRACE_MS}: another run may be
 *   mid-call, so wait for the next pass.
 * - Still a draft and claimed long ago: that call never landed, so send it.
 * @param claimedAt - When a run claimed the send call, or null.
 * @param status - The broadcast's status at Resend.
 * @param now - The current time.
 * @returns "done", "send" or "wait".
 */
export function sendDecision(
  claimedAt: Date | null,
  status: "draft" | "queued" | "sent",
  now: Date,
): "done" | "send" | "wait" {
  if (status !== "draft") return "done";
  if (!claimedAt) return "send";
  return now.getTime() - claimedAt.getTime() < SEND_CLAIM_GRACE_MS ? "wait" : "send";
}
