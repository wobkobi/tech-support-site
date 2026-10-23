// src/features/mailing/lib/draft-brief.ts
// The last "Draft with AI" brief for each email, kept on the email so reopening the dialog on any
// device brings it back to change and redraft, along with the pictures it put in.

import {
  BRIEF_MAX,
  DRAFT_KINDS,
  MAX_DRAFT_PICTURES,
  POST_SOURCE_MAX,
} from "@/features/mailing/lib/ai-draft";

/** What the dialog had in it when it was closed or a draft was written. */
export interface DraftBrief {
  brief: string;
  kind: string;
  withSubject: boolean;
  withPicture: boolean;
  /** The pictures the last draft put in the email, so the next draft takes them out first. */
  pictures: string[];
  /** The brief is a social post's words, from Email this too. */
  source?: "post";
}

/** What the dialog opens with when an email has no brief kept. */
export const NO_DRAFT_BRIEF: DraftBrief = {
  brief: "",
  kind: DRAFT_KINDS[0]!.key,
  withSubject: true,
  withPicture: true,
  pictures: [],
};

/** Longest picture address kept. */
const URL_MAX = 2048;

/**
 * Reads a kept or sent brief. A kind that's no longer offered falls back to the first.
 * @param value - The stored value, or a request body.
 * @returns The brief, or null when it isn't one.
 */
export function readDraftBrief(value: unknown): DraftBrief | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Partial<Record<keyof DraftBrief, unknown>>;
  if (typeof r.brief !== "string") return null;
  const fromPost = r.source === "post";
  return {
    brief: r.brief.slice(0, fromPost ? POST_SOURCE_MAX : BRIEF_MAX),
    kind: DRAFT_KINDS.find((k) => k.key === r.kind)?.key ?? NO_DRAFT_BRIEF.kind,
    withSubject: r.withSubject !== false,
    withPicture: r.withPicture !== false,
    pictures: Array.isArray(r.pictures)
      ? r.pictures
          .filter((p): p is string => typeof p === "string" && p.length <= URL_MAX)
          .slice(0, MAX_DRAFT_PICTURES)
      : [],
    ...(fromPost ? { source: "post" as const } : {}),
  };
}

/**
 * The brief Email this too opens the dialog with: the post's words and a subject, with no new
 * picture, since the email already has the post's.
 * @param brief - The post's words, stripped for email.
 * @param pictures - The last draft's pictures, which still come out on the next draft.
 * @returns The brief.
 */
export function postDraftBrief(brief: string, pictures: readonly string[] = []): DraftBrief {
  return {
    brief: brief.slice(0, POST_SOURCE_MAX),
    kind: NO_DRAFT_BRIEF.kind,
    withSubject: true,
    withPicture: false,
    pictures: [...pictures],
    source: "post",
  };
}

/**
 * Whether the dialog's boxes still hold what's kept, so closing it has nothing to save.
 * @param a - What the dialog has in it.
 * @param b - What's kept.
 * @returns True when the brief, kind, ticks and source all match.
 */
export function sameDraftBrief(a: DraftBrief, b: DraftBrief): boolean {
  return (
    a.brief === b.brief &&
    a.kind === b.kind &&
    a.withSubject === b.withSubject &&
    a.withPicture === b.withPicture &&
    a.source === b.source
  );
}
