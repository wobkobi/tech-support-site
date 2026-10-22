// src/features/social/lib/queue-slots.ts
// Schedule maths: time slot labels, the instants a schedule's weekly slots fall on in NZ time,
// which content item fills a slot, and what the next slots hold. Pure and client-safe.

import { spentReason } from "@/features/social/lib/postings-core";
import type { SocialPlatformKey } from "@/features/social/lib/validate";
import { SLOT_MINUTE_RANGE, SLOT_MINUTE_STEP } from "@/shared/lib/settings/field-meta";
import {
  DAY_NAMES,
  addDaysToDateKey,
  dateKeyParts,
  nzDateKey,
  nzMinuteOfDay,
  nzWallClockUtc,
  nzWeekday,
  type Weekday,
} from "@/shared/lib/timezone-utils";

const DAY_MS = 86_400_000;

export const QUEUE_ORDERS = ["oldest_first", "in_order", "shuffle"] as const;
export type QueueOrder = (typeof QUEUE_ORDERS)[number];

export const QUEUE_ORDER_LABEL: Record<QueueOrder, string> = {
  oldest_first: "Oldest posted first",
  in_order: "In the order below",
  shuffle: "Mixed up",
};

export const QUEUE_ORDER_HINT: Record<QueueOrder, string> = {
  oldest_first: "The item that went out longest ago goes next. Ones never posted go first.",
  in_order: "Goes down the list, then starts again at the top.",
  shuffle: "Picks at random each time, still keeping the gap between repeats.",
};

/** Most time slots one schedule can have: four a day. */
export const MAX_SLOTS = 28;
/** Most content items one schedule can hold. */
export const MAX_QUEUE_ITEMS = 200;
export const MAX_QUEUE_NAME = 60;
/** Days a schedule can wait before posting the same item again. */
export const MIN_GAP_RANGE = { min: 0, max: 365 } as const;
/** How long before a slot the filler stops lining it up, so a posting is never made too late. */
export const FILL_LEAD_MS = 10 * 60_000;
/** Slots the schedule editor lists under Upcoming. */
export const UPCOMING_COUNT = 10;

/** Weekdays Monday first, as the slot grid shows them. */
export const WEEK_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** A weekly time slot: a weekday (0 = Sunday) and minutes after NZ midnight. */
export interface QueueSlot {
  weekday: number;
  minute: number;
}

/**
 * A time of day as the admin reads it, like "9:00am" or "12:30pm".
 * @param minute - Minutes after midnight.
 * @returns The label.
 */
export function minuteLabel(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = String(minute % 60).padStart(2, "0");
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m}${h < 12 ? "am" : "pm"}`;
}

/**
 * Every time a slot can take, in 15-minute steps, for the time pickers.
 * @returns Minutes after midnight, earliest first.
 */
export function slotMinutes(): number[] {
  const out: number[] = [];
  for (let m = SLOT_MINUTE_RANGE.min; m <= SLOT_MINUTE_RANGE.max; m += SLOT_MINUTE_STEP) {
    out.push(m);
  }
  return out;
}

/**
 * Whether a value is a usable slot.
 * @param slot - Raw value.
 * @returns True for a weekday 0-6 and an allowed time.
 */
export function isQueueSlot(slot: unknown): slot is QueueSlot {
  if (typeof slot !== "object" || slot === null) return false;
  const { weekday, minute } = slot as Record<string, unknown>;
  return (
    Number.isInteger(weekday) &&
    (weekday as number) >= 0 &&
    (weekday as number) <= 6 &&
    Number.isInteger(minute) &&
    (minute as number) >= SLOT_MINUTE_RANGE.min &&
    (minute as number) <= SLOT_MINUTE_RANGE.max &&
    (minute as number) % SLOT_MINUTE_STEP === 0
  );
}

/**
 * A slot's identity, for sets and matching.
 * @param slot - The slot.
 * @returns "weekday:minute".
 */
export function slotKey(slot: QueueSlot): string {
  return `${slot.weekday}:${slot.minute}`;
}

/**
 * Slots Monday first, then by time, with repeats dropped.
 * @param slots - Slots in any order.
 * @returns A new sorted list.
 */
export function sortSlots(slots: readonly QueueSlot[]): QueueSlot[] {
  const seen = new Set<string>();
  /**
   * A weekday's place in the week, Monday first.
   * @param weekday - Weekday number, 0 for Sunday.
   * @returns 0-6.
   */
  const dayRank = (weekday: number): number => WEEK_ORDER.indexOf(weekday as Weekday);
  return [...slots]
    .sort((a, b) => dayRank(a.weekday) - dayRank(b.weekday) || a.minute - b.minute)
    .filter((s) => {
      const key = slotKey(s);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * The weekly slot an instant falls on in NZ time.
 * @param at - The instant.
 * @returns Its weekday and minute.
 */
export function slotOf(at: Date): QueueSlot {
  return { weekday: nzWeekday(at), minute: nzMinuteOfDay(at) };
}

/**
 * A schedule's times in a few words: "Mon, Wed, Fri at 9:00am", "Weekdays at 9:00am" or
 * "Every day at 7:30pm", with each time of day as its own part.
 * @param slots - The slots.
 * @returns Plain words; "No times yet" when there are none.
 */
export function describeSlots(slots: readonly QueueSlot[]): string {
  if (slots.length === 0) return "No times yet";
  const byMinute = new Map<number, Set<number>>();
  for (const s of sortSlots(slots)) {
    byMinute.set(s.minute, (byMinute.get(s.minute) ?? new Set()).add(s.weekday));
  }
  return [...byMinute.entries()]
    .sort(([a], [b]) => a - b)
    .map(([minute, days]) => `${dayList(days)} at ${minuteLabel(minute)}`)
    .join("; ");
}

/**
 * A set of weekdays in words, Monday first.
 * @param days - Weekday numbers.
 * @returns "Every day", "Weekdays", "Weekends" or short names.
 */
function dayList(days: ReadonlySet<number>): string {
  if (days.size === 7) return "Every day";
  const weekdays = [1, 2, 3, 4, 5];
  if (days.size === 5 && weekdays.every((d) => days.has(d))) return "Weekdays";
  if (days.size === 2 && days.has(0) && days.has(6)) return "Weekends";
  return WEEK_ORDER.filter((d) => days.has(d))
    .map((d) => DAY_NAMES[d].slice(0, 3))
    .join(", ");
}

/**
 * The instants a schedule's slots fall on, from a time for a number of days. Each NZ date is
 * walked by its key and given that date's own offset, so a slot keeps its wall-clock time across
 * a daylight saving change.
 * @param slots - The weekly slots.
 * @param from - The earliest instant to include.
 * @param days - How many days on from `from` to cover.
 * @returns Instants in order, none earlier than `from` and all before `from` plus `days`.
 */
export function slotInstants(slots: readonly QueueSlot[], from: Date, days: number): Date[] {
  if (slots.length === 0 || days <= 0) return [];
  const end = from.getTime() + days * DAY_MS;
  const firstKey = nzDateKey(from);
  const seen = new Set<number>();
  const out: Date[] = [];
  // One extra date covers the end falling partway through a day.
  for (let i = 0; i <= days; i++) {
    const key = addDaysToDateKey(firstKey, i);
    const [y, m, d] = dateKeyParts(key);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    for (const s of slots) {
      if (s.weekday !== weekday) continue;
      const at = nzWallClockUtc(y, m, d, Math.floor(s.minute / 60), s.minute % 60);
      const ms = at.getTime();
      if (ms < from.getTime() || ms >= end || seen.has(ms)) continue;
      seen.add(ms);
      out.push(at);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * The next few slot instants from a time, however far apart they are.
 * @param slots - The weekly slots.
 * @param from - The earliest instant.
 * @param count - How many.
 * @returns Up to `count` instants in order.
 */
export function nextSlotInstants(slots: readonly QueueSlot[], from: Date, count: number): Date[] {
  if (slots.length === 0) return [];
  // Enough whole weeks to hold `count` slots, plus one for the part week at the start.
  const weeks = Math.ceil(count / slots.length) + 1;
  return slotInstants(slots, from, weeks * 7).slice(0, count);
}

/** A content item as the slot picker sees it. */
export interface QueueCandidate {
  id: string;
  /** Apps the item is set up to post to. */
  platforms: SocialPlatformKey[];
  recycle: boolean;
  expiresAt: Date | null;
  maxPosts: number | null;
  /** When each of its postings went out or is lined up for, in ms. */
  times: number[];
}

/** The schedule's side of a pick. */
export interface PickRules {
  order: QueueOrder;
  /** The schedule's items in its own order. */
  itemIds: readonly string[];
  platforms: readonly SocialPlatformKey[];
  minGapDays: number;
  /** The item in the schedule's slot just before this one, for In the order below. */
  lastItemId: string | null;
}

/**
 * Whether an item can fill a slot: not finished by then, recycling or never posted, no posting
 * within the gap either side, and at least one app in common with the schedule.
 * @param c - The item.
 * @param rules - The schedule's rules.
 * @param at - The slot.
 * @returns True when it can go.
 */
export function canFill(c: QueueCandidate, rules: PickRules, at: Date): boolean {
  const stats = { count: c.times.length, lastPostedAt: null, nextAt: null };
  if (spentReason(c, stats, at)) return false;
  if (!c.recycle && c.times.length > 0) return false;
  if (!c.platforms.some((p) => rules.platforms.includes(p))) return false;
  const gap = rules.minGapDays * DAY_MS;
  const ms = at.getTime();
  // A gap of 0 still keeps one item to one posting at a time.
  return !c.times.some((t) => Math.abs(t - ms) < Math.max(gap, 1));
}

/**
 * A steady pseudo-random number for a string (FNV-1a), so a mixed-up schedule picks the same
 * way each time the same slot is worked out.
 * @param text - The seed.
 * @returns An unsigned 32-bit number.
 */
function seeded(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The items that can fill a slot, best first by the schedule's order. The filler tries them in
 * turn, so one that fails its final check gives way to the next.
 * @param candidates - The schedule's items.
 * @param rules - The schedule's rules.
 * @param at - The slot.
 * @returns Item ids, best first; empty when nothing can go.
 */
export function rankCandidates(
  candidates: readonly QueueCandidate[],
  rules: PickRules,
  at: Date,
): string[] {
  const position = new Map(rules.itemIds.map((id, i) => [id, i]));
  const ok = candidates.filter((c) => position.has(c.id) && canFill(c, rules, at));
  /**
   * An item's place in the schedule's list.
   * @param c - The item.
   * @returns Its index.
   */
  const pos = (c: QueueCandidate): number => position.get(c.id) ?? 0;
  switch (rules.order) {
    case "oldest_first": {
      /**
       * When an item last went out or is lined up for; never posted counts as oldest of all.
       * @param c - The item.
       * @returns Ms, or -Infinity for never.
       */
      const latest = (c: QueueCandidate): number =>
        c.times.length > 0 ? Math.max(...c.times) : -Infinity;
      return ok.sort((a, b) => latest(a) - latest(b) || pos(a) - pos(b)).map((c) => c.id);
    }
    case "in_order": {
      const n = rules.itemIds.length;
      const last = rules.lastItemId ? (position.get(rules.lastItemId) ?? -1) : -1;
      /**
       * Distance down the list from the one after the last used, going round to the top.
       * @param c - The item.
       * @returns Steps ahead.
       */
      const ahead = (c: QueueCandidate): number => (pos(c) - (last + 1) + n) % n;
      return ok.sort((a, b) => ahead(a) - ahead(b)).map((c) => c.id);
    }
    case "shuffle": {
      const seed = String(at.getTime());
      return ok
        .sort((a, b) => seeded(`${seed}:${a.id}`) - seeded(`${seed}:${b.id}`))
        .map((c) => c.id);
    }
  }
}

/** What one upcoming slot holds. */
export type UpcomingState = "lined-up" | "skipped" | "empty" | "no-items" | "later" | "paused";

/** One upcoming slot for the schedule editor. */
export interface UpcomingSlot {
  at: string;
  state: UpcomingState;
  /** The posting in it, when there is one. */
  post: { id: string; name: string; status: string; captionIndex: number | null } | null;
}

/**
 * The next slots of a schedule and what each holds, for the editor's Upcoming list.
 * @param queue - The schedule.
 * @param queue.slots - Its weekly slots.
 * @param queue.paused - Whether it's paused.
 * @param queue.itemIds - Its items.
 * @param queue.skipped - Slot times taken off by hand.
 * @param postings - The schedule's postings in the window, any status.
 * @param now - Now.
 * @param fillDays - How far ahead the filler lines slots up.
 * @returns Up to {@link UPCOMING_COUNT} slots in order.
 */
export function upcomingSlots(
  queue: { slots: QueueSlot[]; paused: boolean; itemIds: string[]; skipped: Date[] },
  postings: readonly {
    id: string;
    name: string;
    status: string;
    scheduledAt: Date | null;
    captionIndex: number | null;
  }[],
  now: Date,
  fillDays: number,
): UpcomingSlot[] {
  const byTime = new Map(
    postings.flatMap((p) => (p.scheduledAt ? [[p.scheduledAt.getTime(), p] as const] : [])),
  );
  const skipped = new Set(queue.skipped.map((d) => d.getTime()));
  const horizon = now.getTime() + fillDays * DAY_MS;
  return nextSlotInstants(queue.slots, now, UPCOMING_COUNT).map((at) => {
    const ms = at.getTime();
    const p = byTime.get(ms);
    const post = p
      ? { id: p.id, name: p.name, status: p.status, captionIndex: p.captionIndex }
      : null;
    let state: UpcomingState;
    if (post) state = "lined-up";
    else if (skipped.has(ms)) state = "skipped";
    else if (queue.paused) state = "paused";
    else if (ms >= horizon) state = "later";
    else if (queue.itemIds.length === 0) state = "no-items";
    else state = "empty";
    return { at: at.toISOString(), state, post };
  });
}
