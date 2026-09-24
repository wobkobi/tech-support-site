// src/features/business/lib/calculator-draft.ts
// localStorage draft persistence for the job calculator: the persisted shape, the
// read/write/clear helpers, and the "Draft restored" age label.

import type {
  ParsedRange,
  PartLine,
  TaskLine,
  TravelEntry,
} from "@/features/business/types/business";

/**
 * localStorage key for the calculator draft. Bump the version suffix when
 * CalculatorDraft fields change so stale shapes can't crash the form.
 */
const DRAFT_KEY = "calculator-draft-v2";

/**
 * sessionStorage key for the one-shot "Describe the job" handoff across the
 * event picker's navigation. The page keys this component by eventId, so
 * picking an event remounts it and resets all state; a part-typed description
 * is stashed here just before the push and consumed on the next mount.
 */
export const AI_INPUT_HANDOFF_KEY = "calculator-ai-input-handoff";

/**
 * Subset of CalculatorView state persisted across refreshes. Excludes
 * server-fetched data, UI flags, and the AI-parse session; the "Describe the
 * job" text itself IS persisted (`aiInput`).
 */
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
  /** Out-of-session minutes added to the slot sum (0 = none). */
  followUpMins: number;
  travelEntries: TravelEntry[];
  jobAddress: string;
  tasks: TaskLine[];
  parts: PartLine[];
  notes: string;
  clientName: string;
  clientEmail: string;
  pickedContactName: string | null;
  pickedContactCompany: string | null;
  pickedContactGoogleId: string | null;
  addressMode: "name" | "company" | "custom";
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
    d.clientName.trim().length > 0 ||
    d.clientEmail.trim().length > 0 ||
    d.jobAddress.trim().length > 0 ||
    d.pickedContactName !== null ||
    d.pickedContactCompany !== null ||
    d.followUpMins > 0
  );
}

/**
 * Reads the saved draft from localStorage. Returns null when missing, corrupt,
 * or schema-version mismatched (old shapes are ignored, not crashed on).
 * @returns Parsed draft, or null.
 */
export function loadDraft(): CalculatorDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CalculatorDraft;
    if (parsed?.v !== 2) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Writes the draft to localStorage with a fresh savedAt timestamp. Failures
 * (quota, private mode etc) are swallowed so persistence never blocks editing.
 * @param draft - Form-state fields to persist (savedAt + v are added here).
 */
export function saveDraft(draft: Omit<CalculatorDraft, "v" | "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const payload: CalculatorDraft = { v: 2, savedAt: Date.now(), ...draft };
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  } catch {
    /* QuotaExceeded or private mode - silently degrade */
  }
}

/** Drops the saved draft so the next mount starts clean. */
export function clearDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Renders a "X min ago" label given a stable now timestamp for the
 * draft-restored toast.
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
