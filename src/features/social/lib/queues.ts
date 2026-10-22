// src/features/social/lib/queues.ts
// Schedules as the admin sees them, and the parser for creating or changing one. Pure and
// client-safe.

import { parseObjectId } from "@/features/business/lib/validation";
import {
  MAX_QUEUE_ITEMS,
  MAX_QUEUE_NAME,
  MAX_SLOTS,
  MIN_GAP_RANGE,
  QUEUE_ORDERS,
  isQueueSlot,
  sortSlots,
  type QueueOrder,
  type QueueSlot,
} from "@/features/social/lib/queue-slots";
import { isTagColour, type TagColour } from "@/features/social/lib/tags";
import {
  PLATFORM_LABEL,
  SOCIAL_PLATFORMS,
  type SocialPlatformKey,
} from "@/features/social/lib/validate";
import type { SocialQueue } from "@prisma/client";

/** A schedule as the admin sees it. */
export interface QueueRow {
  id: string;
  name: string;
  colour: TagColour;
  paused: boolean;
  platforms: SocialPlatformKey[];
  slots: QueueSlot[];
  order: QueueOrder;
  minGapDays: number;
  itemIds: string[];
}

/** The fields a schedule is made with or changed by. */
export type QueueInput = Omit<QueueRow, "id">;

/** A schedule as a content item's page lists it. */
export interface ItemQueue {
  id: string;
  name: string;
  colour: TagColour;
  paused: boolean;
  /** Whether the item is in it. */
  member: boolean;
}

/**
 * Why a schedule won't post one of its items, for a warning beside it in the list.
 * @param item - The item as the library has it.
 * @param item.spent - Past its last day or at its limit.
 * @param item.recycle - Whether it can go out more than once.
 * @param item.posted - Postings it has had, lined-up ones included.
 * @param item.platforms - The apps it's switched on for.
 * @param queuePlatforms - The schedule's apps.
 * @returns The reason, or null when it can go out.
 */
export function itemHold(
  item: {
    spent: boolean;
    recycle: boolean;
    posted: number;
    platforms: readonly SocialPlatformKey[];
  },
  queuePlatforms: readonly SocialPlatformKey[],
): string | null {
  if (item.spent) return "Finished, so it won't go out again.";
  if (!item.recycle && item.posted > 0) {
    return "Recycling is off and it's had a posting, so it won't get another.";
  }
  if (!item.platforms.some((p) => queuePlatforms.includes(p))) {
    const apps = queuePlatforms.map((p) => PLATFORM_LABEL[p]).join(" or ");
    return `It isn't switched on for ${apps}.`;
  }
  return null;
}

/** What a fill did, as the routes send it. */
export interface FillSummaryInput {
  made: number;
  queues: { empty: number }[];
}

/**
 * Plain words for what a save or fill changed in the lined-up posts, for a toast.
 * @param cleared - Lined-up postings deleted.
 * @param fill - The fill that followed, or null when none ran.
 * @returns A sentence or two, empty when nothing changed.
 */
export function fillSummary(cleared: number, fill: FillSummaryInput | null): string {
  /**
   * A count of posts in words.
   * @param n - How many.
   * @returns "1 post" or "N posts".
   */
  const posts = (n: number): string => (n === 1 ? "1 post" : `${n} posts`);
  const parts: string[] = [];
  if (cleared > 0) parts.push(`${posts(cleared)} that no longer fit taken off.`);
  if (fill && fill.made > 0) parts.push(`${posts(fill.made)} lined up.`);
  const empty = fill ? fill.queues.reduce((n, q) => n + q.empty, 0) : 0;
  if (empty > 0) {
    parts.push(
      `${empty === 1 ? "1 time" : `${empty} times`} left empty: nothing could go out then.`,
    );
  }
  return parts.join(" ");
}

/** A new schedule's starting values. */
export const NEW_QUEUE: QueueInput = {
  name: "",
  colour: "violet",
  paused: false,
  platforms: ["facebook", "google"],
  slots: [],
  order: "oldest_first",
  minGapDays: 14,
  itemIds: [],
};

/**
 * A schedule row for the admin.
 * @param q - The stored schedule.
 * @returns The row.
 */
export function toQueueRow(q: SocialQueue): QueueRow {
  return {
    id: q.id,
    name: q.name,
    colour: isTagColour(q.colour) ? q.colour : "grey",
    paused: q.paused,
    platforms: q.platforms,
    slots: sortSlots(q.slots),
    order: q.order,
    minGapDays: q.minGapDays,
    itemIds: q.itemIds,
  };
}

/**
 * Reads a schedule from a request body. A full read (a new schedule) needs a name and fills the
 * rest from {@link NEW_QUEUE}; a partial read keeps only the fields sent.
 * @param raw - Request body.
 * @param partial - True for a change to an existing schedule.
 * @returns The fields, or the first problem.
 */
export function parseQueueInput(
  raw: unknown,
  partial: boolean,
): { data: Partial<QueueInput> } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "Send the schedule's details." };
  const body = raw as Record<string, unknown>;
  const data: Partial<QueueInput> = partial ? {} : { ...NEW_QUEUE };

  if ("name" in body || !partial) {
    const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";
    if (!name) return { error: "Give the schedule a name." };
    if (name.length > MAX_QUEUE_NAME) {
      return { error: `Keep the name under ${MAX_QUEUE_NAME} characters.` };
    }
    data.name = name;
  }
  if ("colour" in body) {
    if (!isTagColour(body.colour)) return { error: "Pick one of the listed colours." };
    data.colour = body.colour;
  }
  if ("paused" in body) {
    if (typeof body.paused !== "boolean") return { error: "paused must be true or false." };
    data.paused = body.paused;
  }
  if ("platforms" in body) {
    const list = body.platforms;
    if (
      !Array.isArray(list) ||
      !list.every((p) => (SOCIAL_PLATFORMS as readonly unknown[]).includes(p))
    ) {
      return { error: "platforms must list Facebook, Instagram or Google." };
    }
    const platforms = SOCIAL_PLATFORMS.filter((p) => list.includes(p));
    if (platforms.length === 0) return { error: "Pick at least one app to post to." };
    data.platforms = platforms;
  }
  if ("slots" in body) {
    if (!Array.isArray(body.slots) || !body.slots.every(isQueueSlot)) {
      return { error: "Each time must be a day and a time from 5:00am to 11:45pm." };
    }
    const slots = sortSlots(body.slots.map((s) => ({ weekday: s.weekday, minute: s.minute })));
    if (slots.length > MAX_SLOTS) return { error: `Keep it to ${MAX_SLOTS} times a week.` };
    data.slots = slots;
  }
  if ("order" in body) {
    if (!(QUEUE_ORDERS as readonly unknown[]).includes(body.order)) {
      return { error: "Pick one of the listed orders." };
    }
    data.order = body.order as QueueOrder;
  }
  if ("minGapDays" in body) {
    const n = body.minGapDays;
    if (
      typeof n !== "number" ||
      !Number.isInteger(n) ||
      n < MIN_GAP_RANGE.min ||
      n > MIN_GAP_RANGE.max
    ) {
      return {
        error: `The gap must be a whole number of days, ${MIN_GAP_RANGE.min}-${MIN_GAP_RANGE.max}.`,
      };
    }
    data.minGapDays = n;
  }
  if ("itemIds" in body) {
    if (!Array.isArray(body.itemIds)) return { error: "itemIds must be a list." };
    const ids = body.itemIds.map(parseObjectId);
    if (ids.some((id) => id === null)) return { error: "itemIds holds an invalid id." };
    const unique = [...new Set(ids as string[])];
    if (unique.length > MAX_QUEUE_ITEMS) {
      return { error: `Keep it to ${MAX_QUEUE_ITEMS} content items.` };
    }
    data.itemIds = unique;
  }
  return { data };
}
