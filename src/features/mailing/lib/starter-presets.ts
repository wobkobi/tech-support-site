// src/features/mailing/lib/starter-presets.ts
// The starter mailing presets' wording. Kept apart from the seeding in presets.ts so the
// checks can read it without loading the database client.

import { GOOGLE_BUSINESS_PROFILE_URL } from "@/shared/lib/business-profiles";

/** presetKey of the preset "Email this promo" starts from. */
export const PROMO_PRESET_KEY = "promo";

/**
 * Presets added after the first seeding. Installs seeded before them get just these on
 * the next Mailing page load, so a starter the operator deleted stays deleted.
 */
export const V2_PRESET_KEYS: readonly string[] = ["announcement", "review-showcase", "tip"];

/** A starter preset's content. */
export interface StarterPreset {
  presetKey: string;
  name: string;
  subject: string;
  preheader: string;
  body: string;
}

/**
 * The starter set. Dates and prices inside them are examples for the operator
 * to overwrite.
 * @param siteUrl - Site origin for the booking buttons.
 * @returns The presets in display order.
 */
export function starterPresets(siteUrl: string): StarterPreset[] {
  const book = `[Book a time](${siteUrl}/booking)`;
  return [
    {
      presetKey: PROMO_PRESET_KEY,
      name: "New promo",
      subject: "{promoOffer} on tech help until {promoEnds}",
      preheader: "A quick heads-up about a deal I'm running.",
      body: [
        "Hi {firstName},",
        "",
        "Just a quick heads-up that I'm running a deal at the moment.",
        "",
        "::promo",
        "",
        "If something's been bugging you, like a slow computer, a phone that won't do what you want, or email that's stopped working, now's a good time to get it sorted.",
        "",
        book,
        "",
        "Or just reply to this email and I'll get back to you.",
      ].join("\n"),
    },
    {
      presetKey: "promo-ending",
      name: "Promo ending soon",
      subject: "Last chance: {promoOffer} ends {promoEnds}",
      preheader: "My current deal is nearly over.",
      body: [
        "Hi {firstName},",
        "",
        "Just a reminder that my current deal is nearly over.",
        "",
        "::promo",
        "",
        "If you've been meaning to get something looked at, now's the time to book.",
        "",
        book,
      ].join("\n"),
    },
    {
      presetKey: "away",
      name: "Away / holiday hours",
      subject: "I'm taking a break over the holidays",
      preheader: "When I'm away and when I'm back.",
      body: [
        "Hi {firstName},",
        "",
        "Just letting you know I'm taking a break from **Saturday 20 December** and I'll be back on **Monday 5 January**.",
        "",
        "You can still book online while I'm away and I'll confirm it when I'm back. If something's urgent, send me an email and I'll reply as soon as I can.",
        "",
        "Have a great break!",
      ].join("\n"),
    },
    {
      presetKey: "scam-warning",
      name: "Scam warning",
      subject: "Watch out for this scam going around",
      preheader: "What it looks like and what to do if you get one.",
      body: [
        "Hi {firstName},",
        "",
        "A few people have been in touch about a scam doing the rounds, so I wanted to give you a heads-up.",
        "",
        "## What it looks like",
        "",
        "Describe the message or call here, for example a text saying a parcel couldn't be delivered, with a link to pay a small fee.",
        "",
        "## How to spot it",
        "",
        "- It wants you to click a link or pay money in a hurry",
        "- The sender's address or number doesn't match the real company",
        "- It asks for a password, your bank details or a code sent to your phone",
        "",
        "## What to do",
        "",
        "Don't click the link or reply, just delete it. If you've already clicked or typed in your details, call your bank straight away, then get in touch and I'll help you check your devices.",
        "",
        "If you're ever not sure about a message, forward it to me and I'll tell you if it's genuine.",
      ].join("\n"),
    },
    {
      presetKey: "price-change",
      name: "Price change notice",
      subject: "A change to my prices",
      preheader: "What's changing and when.",
      body: [
        "Hi {firstName},",
        "",
        "I wanted to let you know before it happens: from **1 April** my hourly rate is going from **$X** to **$Y**.",
        "",
        "Anything booked before then stays at the current rate.",
        "",
        "Thanks for sticking with me. If you've got any questions, just reply to this email.",
      ].join("\n"),
    },
    {
      presetKey: "general",
      name: "General update",
      subject: "A quick update",
      preheader: "",
      body: [
        "Hi {firstName},",
        "",
        "# Your heading here",
        "",
        "Write your update here.",
        "",
        `[Find out more](${siteUrl})`,
      ].join("\n"),
    },
    {
      presetKey: "checking-in",
      name: "Checking in",
      subject: "Anything giving you trouble lately?",
      preheader: "It's been a while, so I thought I'd check in.",
      body: [
        "Hi {firstName},",
        "",
        "It's been a while, so I thought I'd check in. Is anything with your computer, phone or internet giving you grief at the moment?",
        "",
        "It might be something small, like a printer that won't connect, or photos you'd like backed up before something goes wrong. Either way, I'm happy to come and take a look.",
        "",
        book,
        "",
        "Or just reply to this email and tell me what's going on.",
      ].join("\n"),
    },
    {
      presetKey: "announcement",
      name: "Announcement",
      subject: "Some news from me",
      preheader: "Something new I wanted you to hear about first.",
      body: [
        "![A picture that goes with your news]()",
        "",
        "# Your news in a few words",
        "",
        "Hi {firstName},",
        "",
        "Say what's new and what it means for them. Keep it to two or three short sentences.",
        "",
        book,
      ].join("\n"),
    },
    {
      presetKey: "review-showcase",
      name: "What people are saying",
      subject: "What people have been saying",
      preheader: "A few kind words from people I've helped.",
      body: [
        "Hi {firstName},",
        "",
        "I like to share a kind word now and then. Here's what someone said after I helped them recently:",
        "",
        "> ★★★★★",
        "> Paste a real review here, word for word.",
        "> - Their first name, suburb",
        "",
        "If I've helped you too, a review on Google means a lot. It's how most people find me.",
        "",
        `[Read more reviews on Google](${GOOGLE_BUSINESS_PROFILE_URL})`,
      ].join("\n"),
    },
    {
      presetKey: "tip",
      name: "Tech tip",
      subject: "A quick tech tip",
      preheader: "Something small that saves a headache later.",
      body: [
        "Hi {firstName},",
        "",
        "# Your tip in a few words",
        "",
        "Say in a sentence or two why it matters.",
        "",
        "## How to do it",
        "",
        "- First step",
        "- Second step",
        "- Third step",
        "",
        "If you'd like a hand with it, I'm happy to come and help.",
        "",
        book,
      ].join("\n"),
    },
  ];
}
