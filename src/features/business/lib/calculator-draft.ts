// src/features/business/lib/calculator-draft.ts
// localStorage draft persistence for the job calculator: the persisted shape, the
// read/write/clear helpers, and the "Draft restored" age label. A calendar job or re-issue
// keeps its own draft, so its work restores only on that job and keeps the booking link.

import type { AlreadyPaidState } from "@/features/business/lib/already-paid-input";
import { timeDiffMins } from "@/features/business/lib/business";
import type {
  ParsedRange,
  PartLine,
  TaskLine,
  TravelEntry,
} from "@/features/business/types/business";

/** localStorage key for the calculator draft; bump the version when its shape changes. */
const DRAFT_KEY = "calculator-draft-v2";

/** A job draft nobody came back to for this long is dropped on the next load. */
const JOB_DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * sessionStorage key carrying a part-typed "Describe the job" across the remount that
 * picking an event causes. Consumed on the next mount.
 */
export const AI_INPUT_HANDOFF_KEY = "calculator-ai-input-handoff";

/** CalculatorView form state persisted across refreshes (no server data or UI flags). */
export interface CalculatorDraft {
  v: 2;
  savedAt: number;
  /** The "Describe the job" textarea text. */
  aiInput: string;
  /** Date the job was done (YYYY-MM-DD); drives the holiday + promo lookup. */
  jobDate: string;
  /** Applied promo code, uppercase, or "" for none. */
  promoCode: string;
  timeRanges: ParsedRange[];
  /** False while `timeRanges` is the blank form's placeholder hour; missing reads as true. */
  timesSet?: boolean;
  /** Out-of-session minutes added to the slot sum (0 = none). */
  followUpMins: number;
  travelEntries: TravelEntry[];
  jobAddress: string;
  tasks: TaskLine[];
  parts: PartLine[];
  notes: string;
  /** "Paid in cash" tick. Optional so drafts saved before it existed still load. */
  paidCash?: boolean;
  /** Already paid box. Optional so drafts saved before it existed still load. */
  alreadyPaid?: AlreadyPaidState;
  /** Gold Card tick. Optional so drafts saved before it existed still load. */
  goldCard?: boolean;
  clientName: string;
  clientEmail: string;
  pickedContactName: string | null;
  pickedContactCompany: string | null;
  pickedContactGoogleId: string | null;
  addressMode: "name" | "company" | "custom";
  /** A job draft's event date and times when saved; edited events since win over its times. */
  eventTimes?: string;
}

/**
 * True when the draft has at least one operator-entered field - auto-seeded
 * values alone aren't worth a "Draft restored" toast.
 * @param d - Parsed draft.
 * @returns Whether the draft is worth announcing on restore.
 */
export function isMeaningfulDraft(d: CalculatorDraft): boolean {
  return (
    (d.aiInput?.trim().length ?? 0) > 0 ||
    d.tasks.length > 0 ||
    d.parts.length > 0 ||
    d.travelEntries.length > 0 ||
    d.notes.trim().length > 0 ||
    (d.alreadyPaid?.amount.trim().length ?? 0) > 0 ||
    d.clientName.trim().length > 0 ||
    d.clientEmail.trim().length > 0 ||
    d.jobAddress.trim().length > 0 ||
    d.pickedContactName !== null ||
    d.pickedContactCompany !== null ||
    d.followUpMins > 0
  );
}

/**
 * Whether a draft's Time card is the lone one-hour row a blank form seeds. Used only for
 * drafts saved before they recorded whether their times were real.
 * @param ranges - The draft's time ranges, if any.
 * @returns True when the ranges look like the seeded placeholder hour.
 */
export function isPlaceholderHour(ranges: ParsedRange[] | undefined): boolean {
  if (!ranges || ranges.length > 1) return !ranges;
  const [only] = ranges;
  if (!only?.startTime || !only.endTime) return true;
  return timeDiffMins(only.startTime, only.endTime) === 60;
}

/**
 * The draft scope for a calculator opened on calendar events or a re-issue.
 * @param eventIds - Calendar event ids the job bills; order doesn't matter.
 * @param reissueNumber - The voided invoice's number when re-issuing, else null.
 * @returns A scope for the draft helpers, or null for the plain calculator.
 */
export function draftScopeFor(eventIds: string[], reissueNumber: string | null): string | null {
  if (reissueNumber) return `reissue:${reissueNumber}`;
  return eventIds.length > 0 ? `events:${[...eventIds].sort().join(",")}` : null;
}

/**
 * The storage key for a scope.
 * @param scope - From {@link draftScopeFor}; null is the plain calculator.
 * @returns The localStorage key.
 */
function keyFor(scope: string | null): string {
  return scope ? `${DRAFT_KEY}:${scope}` : DRAFT_KEY;
}

/** Drops job drafts past {@link JOB_DRAFT_MAX_AGE_MS}, plus any that no longer parse. */
function pruneJobDrafts(): void {
  const cutoff = Date.now() - JOB_DRAFT_MAX_AGE_MS;
  for (const key of Object.keys(window.localStorage)) {
    if (!key.startsWith(`${DRAFT_KEY}:`)) continue;
    try {
      const saved = (JSON.parse(window.localStorage.getItem(key) ?? "") as CalculatorDraft).savedAt;
      if (!(saved > cutoff)) window.localStorage.removeItem(key);
    } catch {
      window.localStorage.removeItem(key);
    }
  }
}

/**
 * Reads a saved draft from localStorage.
 * @param scope - From {@link draftScopeFor}; null is the plain calculator.
 * @returns Parsed draft, or null when missing, corrupt or an old version.
 */
export function loadDraft(scope: string | null = null): CalculatorDraft | null {
  if (typeof window === "undefined") return null;
  try {
    pruneJobDrafts();
    const raw = window.localStorage.getItem(keyFor(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CalculatorDraft;
    if (parsed?.v !== 2) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Writes the draft to localStorage with a fresh savedAt; failures are swallowed.
 * @param draft - Form-state fields to persist (savedAt + v are added here).
 * @param scope - From {@link draftScopeFor}; null is the plain calculator.
 */
export function saveDraft(
  draft: Omit<CalculatorDraft, "v" | "savedAt">,
  scope: string | null = null,
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: CalculatorDraft = { v: 2, savedAt: Date.now(), ...draft };
    window.localStorage.setItem(keyFor(scope), JSON.stringify(payload));
  } catch {
    /* QuotaExceeded or private mode - silently degrade */
  }
}

/**
 * Drops a saved draft so the next mount starts clean.
 * @param scope - From {@link draftScopeFor}; null is the plain calculator.
 */
export function clearDraft(scope: string | null = null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(scope));
  } catch {
    /* ignore */
  }
}

/**
 * "X min ago" label for the draft-restored toast.
 * @param savedAt - When the draft was saved.
 * @param now - Reference now (captured once at mount to keep render pure).
 * @returns Display label.
 */
export function timeAgo(savedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - savedAt) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
