// src/features/social/lib/checklist.ts
// The Overview's set-up list: each step, whether it's done from facts the page loads, and the
// ones you've skipped. Pure and client-safe.

import {
  SOCIAL_CONTENT_PATH,
  SOCIAL_POSTS_PATH,
  SOCIAL_SCHEDULES_PATH,
} from "@/features/social/lib/links";

export const CHECKLIST_KEYS = [
  "connect",
  "brand",
  "content",
  "schedule",
  "recycle",
  "email",
] as const;
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];

/** How many content items the content step asks for. */
export const CHECKLIST_ITEMS = 5;

/** What the steps are judged on. */
export interface ChecklistFacts {
  /** Apps whose connection check passed, or null while it runs. */
  connected: number | null;
  /** Whether the brand profile has anything in it. */
  brand: boolean;
  /** Content items. */
  items: number;
  /** Schedules. */
  schedules: number;
  /** Whether any content item has recycling on. */
  recycling: boolean;
  /** Whether Email this too has drafted an email from any post. */
  emailed: boolean;
}

/** One step as the list shows it. */
export interface ChecklistStep {
  key: ChecklistKey;
  title: string;
  detail: string;
  href: string;
  action: string;
  done: boolean;
  skipped: boolean;
}

/** The list, with counts over the steps you haven't skipped. */
export interface Checklist {
  steps: ChecklistStep[];
  done: number;
  total: number;
  /** Every step you haven't skipped is done, so the list can go. */
  complete: boolean;
}

/**
 * Whether a value names a step.
 * @param value - Anything.
 * @returns True for a step key.
 */
export function isChecklistKey(value: unknown): value is ChecklistKey {
  return (CHECKLIST_KEYS as readonly unknown[]).includes(value);
}

/**
 * The set-up list.
 * @param facts - What the steps are judged on.
 * @param skipped - Steps you've skipped.
 * @returns The steps in order, with counts.
 */
export function checklistOf(facts: ChecklistFacts, skipped: readonly string[]): Checklist {
  const appCount = 3;
  const steps: Omit<ChecklistStep, "skipped">[] = [
    {
      key: "connect",
      title: "Connect Facebook, Instagram and Google",
      detail:
        facts.connected === null
          ? "Checking your connections..."
          : `${facts.connected} of ${appCount} connected. A post only goes to the apps that are.`,
      href: "#linked-accounts",
      action: "See connections",
      done: facts.connected === appCount,
    },
    {
      key: "brand",
      title: "Fill in your brand profile",
      detail: "Who your posts are for and how they should sound, so Write with AI gets it right.",
      href: "/admin/settings?tab=social",
      action: "Open settings",
      done: facts.brand,
    },
    {
      key: "content",
      title: `Add ${CHECKLIST_ITEMS} content items`,
      detail: `${facts.items} item${facts.items === 1 ? "" : "s"} so far. Add starter content gives you 16 ready-made ones to start from.`,
      href: SOCIAL_CONTENT_PATH,
      action: "Open Content",
      done: facts.items >= CHECKLIST_ITEMS,
    },
    {
      key: "schedule",
      title: "Make a schedule",
      detail: "Pick days and times, and your content takes turns going out at them.",
      href: `${SOCIAL_SCHEDULES_PATH}/new`,
      action: "Make one",
      done: facts.schedules > 0,
    },
    {
      key: "recycle",
      title: "Turn on recycling",
      detail: "Let a content item go out more than once, so a schedule doesn't run dry.",
      href: SOCIAL_CONTENT_PATH,
      action: "Open Content",
      done: facts.recycling,
    },
    {
      key: "email",
      title: "Draft an email from a post",
      detail: "After a post goes out, Email this too makes a draft for your mailing list from it.",
      href: SOCIAL_POSTS_PATH,
      action: "Open Posts",
      done: facts.emailed,
    },
  ];
  const list = steps.map((s) => ({ ...s, skipped: skipped.includes(s.key) }));
  const counted = list.filter((s) => !s.skipped);
  const done = counted.filter((s) => s.done).length;
  return {
    steps: list,
    done,
    total: counted.length,
    complete: done === counted.length,
  };
}
