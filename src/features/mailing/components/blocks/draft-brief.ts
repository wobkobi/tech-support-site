"use client";
// src/features/mailing/components/blocks/draft-brief.ts
// The last "Draft with AI" brief for each email, kept in this browser so reopening the dialog
// brings it back to change and redraft, along with the picture it put in and its design. Email
// this too seeds one from the social post the email was made from.

import { DRAFT_KINDS } from "@/features/mailing/lib/ai-draft";

/** The post maker design a drafted picture was made in, as the draft left it. */
export interface DraftDesign {
  id: string;
  updatedAt: string;
}

/** What the dialog had in it when the draft was written. */
export interface DraftBrief {
  brief: string;
  kind: string;
  withSubject: boolean;
  withPicture: boolean;
  /** Where the last picture was made, so the next draft draws over it instead of adding one. */
  design: DraftDesign | null;
  /** The picture the last draft put in the email, so a draft without one takes it out. */
  picture: string | null;
  /** The brief is a social post's words, from Email this too. */
  source?: "post";
}

/**
 * Storage key for one email's brief.
 * @param campaignId - The email.
 * @returns The key.
 */
function keyFor(campaignId: string): string {
  return `mailing:draftBrief:${campaignId}`;
}

/**
 * Reads an email's last brief. A kind that's no longer offered falls back to the first.
 * @param campaignId - The email.
 * @returns The brief, or null when none is stored or storage is blocked.
 */
export function readDraftBrief(campaignId: string): DraftBrief | null {
  try {
    const raw = window.localStorage.getItem(keyFor(campaignId));
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<DraftBrief>;
    if (typeof r.brief !== "string") return null;
    const d = r.design;
    return {
      brief: r.brief,
      kind: DRAFT_KINDS.some((k) => k.key === r.kind) ? r.kind! : DRAFT_KINDS[0]!.key,
      withSubject: r.withSubject !== false,
      withPicture: r.withPicture !== false,
      design:
        d && typeof d.id === "string" && typeof d.updatedAt === "string"
          ? { id: d.id, updatedAt: d.updatedAt }
          : null,
      picture: typeof r.picture === "string" ? r.picture : null,
      ...(r.source === "post" ? { source: "post" as const } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Remembers an email's brief.
 * @param campaignId - The email.
 * @param brief - What the dialog had in it.
 */
export function saveDraftBrief(campaignId: string, brief: DraftBrief): void {
  try {
    window.localStorage.setItem(keyFor(campaignId), JSON.stringify(brief));
  } catch {
    // Storage blocked: the dialog just opens empty next time.
  }
}

/**
 * Seeds an email's brief with a social post's words, so its Draft dialog opens ready to write
 * the email from the post. The picture Email this too put in stays: the seed has no picture of
 * its own to take out, and asks for no new one.
 * @param campaignId - The email.
 * @param brief - The post's words, stripped for email.
 */
export function seedPostBrief(campaignId: string, brief: string): void {
  saveDraftBrief(campaignId, {
    brief,
    kind: DRAFT_KINDS[0]!.key,
    withSubject: true,
    withPicture: false,
    design: null,
    picture: null,
    source: "post",
  });
}

/**
 * Remembers the picture a draft put in the email, alongside its brief.
 * @param campaignId - The email.
 * @param picture - The picture's address, or null when the draft has none.
 * @param design - The design a new picture was made in; without one the last is kept.
 */
export function saveDraftPicture(
  campaignId: string,
  picture: string | null,
  design?: DraftDesign,
): void {
  const last = readDraftBrief(campaignId);
  if (last) saveDraftBrief(campaignId, { ...last, picture, design: design ?? last.design });
}
