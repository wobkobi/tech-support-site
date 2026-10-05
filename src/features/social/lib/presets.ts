// src/features/social/lib/presets.ts
// Starter presets for social posts. They are seeded into the database once, the first
// time the Social page opens, and from then on they're ordinary records the operator
// edits or deletes; nothing here is read again after seeding.

import { defaultTargets } from "@/features/social/lib/targets";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";

/** Setting key marking the starter presets as seeded, so deleted ones stay deleted. */
const SEEDED_KEY = "social:presetsSeeded";

/** presetKey of the preset "Post this promo" starts from. */
export const PROMO_POST_PRESET_KEY = "promo";

/** A starter preset's content. */
export interface StarterPostPreset {
  presetKey: string;
  name: string;
  body: string;
  linkUrl: string | null;
}

/**
 * The starter set. Dates inside them are examples for the operator to overwrite.
 * Posts are plain text: no bold or headings, since Facebook and Instagram show the
 * markers as typed.
 * @param siteUrl - Site origin for the booking links.
 * @returns The presets in display order.
 */
export function starterPostPresets(siteUrl: string): StarterPostPreset[] {
  const booking = `${siteUrl}/booking`;
  return [
    {
      presetKey: PROMO_POST_PRESET_KEY,
      name: "New promo",
      body: [
        "I'm running a deal at the moment: {promo}.",
        "",
        "If something's been bugging you, like a slow computer, a phone that won't do what you want, or email that's stopped working, now's a good time to get it sorted.",
        "",
        "Book online, or send me a message.",
      ].join("\n"),
      linkUrl: booking,
    },
    {
      presetKey: "promo-ending",
      name: "Promo ending soon",
      body: [
        "Last chance: {promoOffer} ends {promoEnds}.",
        "",
        "If you've been meaning to get something looked at, now's the time to book.",
      ].join("\n"),
      linkUrl: booking,
    },
    {
      presetKey: "away",
      name: "Away / holiday hours",
      body: [
        "I'm taking a break from Saturday 20 December and I'll be back on Monday 5 January.",
        "",
        "You can still book online while I'm away and I'll confirm it when I'm back.",
      ].join("\n"),
      linkUrl: booking,
    },
    {
      presetKey: "scam-warning",
      name: "Scam warning",
      body: [
        "Scam warning: a few people have been in touch about a scam doing the rounds.",
        "",
        "Describe it here, for example a text saying a parcel couldn't be delivered, with a link to pay a small fee.",
        "",
        "Don't click the link or reply, just delete it. If you've already typed in your details, call your bank straight away.",
        "",
        "Not sure about a message? Send it to me and I'll tell you if it's genuine.",
      ].join("\n"),
      linkUrl: null,
    },
    {
      presetKey: "tech-tip",
      name: "Tech tip",
      body: [
        "Quick tip: write the tip here, in a sentence or two.",
        "",
        "Want a hand setting it up? Book a time and I'll come to you.",
      ].join("\n"),
      linkUrl: booking,
    },
    {
      presetKey: "general",
      name: "General update",
      body: "Write your update here.",
      linkUrl: siteUrl,
    },
  ];
}

/**
 * Seeds the starter presets the first time it runs, and never again. Creating
 * the marker row first doubles as a lock: its unique key makes a second
 * concurrent page load fail the create and skip the seeding.
 */
export async function ensureStarterPostPresets(): Promise<void> {
  const seeded = await prisma.setting.findUnique({ where: { key: SEEDED_KEY } });
  if (seeded) return;
  try {
    await prisma.setting.create({ data: { key: SEEDED_KEY, value: new Date().toISOString() } });
  } catch {
    return;
  }
  await prisma.socialPost.createMany({
    data: starterPostPresets(getSiteUrl()).map((p) => ({
      ...p,
      isPreset: true,
      targets: defaultTargets(),
    })),
  });
}
