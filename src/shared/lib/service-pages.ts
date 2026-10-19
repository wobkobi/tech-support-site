// src/shared/lib/service-pages.ts
// Content for /services/<slug> pages; unlisted categories stay /services#<slug> anchors, decided by serviceHref().

import { SERVICE_AREAS } from "@/shared/lib/service-areas";

/** Service categories that have a detail page. */
export type ServicePageSlug = "printers-scanners" | "wifi-internet" | "setup-transfer" | "security";

/** Copy for one service detail page. */
export interface ServicePage {
  /** `<title>` before the site-wide "| To the Point Tech" suffix. */
  metaTitle: string;
  /** Search result snippet, 160 characters or fewer. */
  metaDescription: string;
  /** The page h1. */
  heading: string;
  /** Opening paragraph under the h1. */
  intro: string;
  /** Link text on the /services card that points here. */
  linkText: string;
  /** Heading over {@link ServicePage.problems}. */
  problemsHeading: string;
  /** 6-8 items in the customer's own words. */
  problems: ReadonlyArray<string>;
  /** 3-4 steps of what a visit looks like. */
  visitSteps: ReadonlyArray<string>;
  /** Typical time range from past jobs. Typical, never a cap. */
  typicalTime: string;
  /** One anonymised job from past invoices. */
  example: string;
  /** Approved review ids to quote, in display order. May be empty. */
  reviewIds: ReadonlyArray<string>;
  /** 2-3 short questions and answers. */
  faqs: ReadonlyArray<{ q: string; a: string }>;
  /** 2-3 other detail pages to link to. */
  related: ReadonlyArray<ServicePageSlug>;
}

export const SERVICE_PAGES: Readonly<Record<ServicePageSlug, ServicePage>> = {
  "wifi-internet": {
    metaTitle: "Wi-Fi and Internet Help in Auckland",
    metaDescription:
      "Wi-Fi dropping out, weak in some rooms, or a new router to set up? I come to your home anywhere in Auckland, find the cause and fix it.",
    heading: "Wi-Fi and internet help in Auckland",
    intro:
      "If your Wi-Fi keeps dropping out, doesn't reach some rooms, or you've got a new router that needs setting up, I can come and sort it. I'll work out whether the problem is the router, where it sits, or the devices connecting to it.",
    linkText: "More about Wi-Fi and internet help",
    problemsHeading: "Common Wi-Fi problems I fix",
    problems: [
      "The Wi-Fi drops out, or you have to restart the router often",
      "Some rooms get a weak signal or none at all",
      "Your internet provider sent a new router and it needs setting up",
      "Devices won't connect, or connect but have no internet",
      "Everything feels slow even though you pay for fast internet",
      "You've moved house and need everything connected again",
      "The TV, printer or smart devices keep losing the connection",
    ],
    visitSteps: [
      "I check the router, its settings and the signal in the rooms you use most.",
      "I fix what I find, whether that's updating the router, changing its settings, moving it or setting up a new one.",
      "If one router can't cover the house, I explain the options and what they cost before you buy anything.",
      "I reconnect your devices, check each one works, and write down the Wi-Fi name and password for you.",
    ],
    typicalTime:
      "Most Wi-Fi jobs take 30 minutes to an hour and a half. Bigger setups with a lot of devices can take longer.",
    example:
      "A customer had new routers to set up across the whole house. I installed them and got their devices connected in about 45 minutes.",
    reviewIds: ["69bbb9bdbd3a540b32d9121d", "6a5b23a1b00db7683072ccd1"],
    faqs: [
      {
        q: "Do I need to buy new equipment?",
        a: "Often not. Many Wi-Fi problems come down to settings, updates or where the router sits. If you do need something, I'll tell you what and why before you spend anything.",
      },
      {
        q: "My internet is down completely. Can you help?",
        a: "If the whole connection is down, the fault is usually with your provider and only they can fix it. I can check your equipment first, so you know whether to call them.",
      },
    ],
    related: ["printers-scanners", "security"],
  },
  "printers-scanners": {
    metaTitle: "Printer and Scanner Help in Auckland",
    metaDescription:
      "Printer offline, won't connect to Wi-Fi, or the scanner stopped working? I come to your home anywhere in Auckland and get it working again.",
    heading: "Printer and scanner help in Auckland",
    intro:
      "If your printer says it's offline, won't connect to the Wi-Fi, or the scanner has stopped working, I can come to you and sort it out. I work with Windows PCs, Macs, phones and tablets.",
    linkText: "More about printer and scanner help",
    problemsHeading: "Common printer problems I fix",
    problems: [
      "The printer says it's offline",
      "It won't connect to the Wi-Fi, or keeps dropping off",
      "It printed fine until you got a new router or computer",
      "The scanner stopped working, or scans don't show up on the computer",
      "You can't print from your phone or iPad",
      "It's plugged in with a cable and you'd rather it worked over Wi-Fi",
      "Print jobs sit in the queue and never come out",
    ],
    visitSteps: [
      "I check the printer, the computer and the Wi-Fi together, because the fault is often in the connection rather than the printer.",
      "I fix what's wrong, whether that's reconnecting it to the network, reinstalling the right driver or setting up the scan app.",
      "I test a print and a scan from each device you use, including phones and tablets if you want them.",
      "I show you what to do if it happens again, and can leave you written notes.",
    ],
    typicalTime: "Most printer and scanner jobs take 30 minutes to an hour.",
    example:
      "A customer's printer was plugged into one computer with a cable, so nobody else in the house could print. I moved it onto the Wi-Fi and set it up on each device. It took about 25 minutes.",
    reviewIds: ["6a1a78807e739cb5fd9ae872", "6a0a685052177f4f4d043f97"],
    faqs: [
      {
        q: "Can you fix it without a visit?",
        a: "Often, yes. Driver problems on a computer can usually be fixed in a remote session. If the printer itself needs reconnecting to the Wi-Fi, a visit is quicker.",
      },
      {
        q: "Should I just buy a new printer?",
        a: "Usually not. Most printers that have stopped working have a connection or driver problem, not a fault. If yours really is worn out, I'll tell you, and I can set up the new one.",
      },
      {
        q: "Can you set up a printer I've just bought?",
        a: "Yes. I'll connect it to your Wi-Fi and get it printing and scanning from every device you use.",
      },
    ],
    related: ["wifi-internet", "setup-transfer"],
  },
  "setup-transfer": {
    metaTitle: "New Computer Setup and Data Transfer in Auckland",
    metaDescription:
      "Got a new computer, laptop or phone? I come to your home anywhere in Auckland, set it up and move your files, photos, email and apps across.",
    heading: "New computer setup and data transfer in Auckland",
    intro:
      "When you get a new computer, laptop or phone, I can set it up and move everything across from the old one: files, photos, email, passwords and the apps you use. You end up with a new device that works the way your old one did.",
    linkText: "More about setup and data transfer",
    problemsHeading: "What I can set up and move",
    problems: [
      "Setting up a new Windows PC, Mac or laptop",
      "Moving files, photos and documents from the old computer",
      "Getting email, contacts and calendars working again",
      "Reinstalling the apps you use, like Microsoft Office",
      "Setting up OneDrive, iCloud or Google so your files back up",
      "Moving to a new phone, even from one with a broken screen",
      "Getting files off an old computer that won't start properly",
      "Removing the extra software new computers come with",
    ],
    visitSteps: [
      "We go through what's on the old device and what you want kept.",
      "I set up the new device with your accounts, then move your files, photos and email across.",
      "I install your apps and check each one opens and is signed in.",
      "I walk you through anything that looks different. Keep the old device until you're happy nothing is missing.",
    ],
    typicalTime:
      "Most new computer setups take an hour to an hour and a half. Getting files off a failing computer can take longer.",
    example:
      "A customer's phone screen broke completely, so they couldn't see anything on it. I set up their new phone and got their data across from the broken one.",
    reviewIds: ["6a2b7d78abdee66cef55a79d"],
    faqs: [
      {
        q: "Do I need to buy anything for the transfer?",
        a: "Usually not. If a transfer needs a part, like an enclosure to read the drive from a computer that won't start, I'll tell you the cost first.",
      },
      {
        q: "What happens to my old computer?",
        a: "That's up to you. I can wipe it so it's safe to give away, sell or recycle.",
      },
      {
        q: "Can you set up a computer for a parent or relative?",
        a: "Yes. Book with their address, and mention who I'll be meeting in the notes.",
      },
    ],
    related: ["security", "wifi-internet"],
  },
  security: {
    metaTitle: "Scam, Virus and Password Help in Auckland",
    metaDescription:
      "Clicked a scam link, seeing virus warnings, or locked out of an account? I come to your home anywhere in Auckland, clean it up and make you safer.",
    heading: "Scam, virus and password help in Auckland",
    intro:
      "If you've clicked a link you shouldn't have, a pop-up says your computer is infected, or you're worried someone has got into your email, I can check what's happened and fix it. I explain it all in plain English, without the scare tactics.",
    linkText: "More about scam, virus and password help",
    problemsHeading: "Common reasons people call me",
    problems: [
      "A pop-up says your computer has a virus and to call a number",
      "You clicked a link in a text or email and now you're worried",
      "Someone may have got into your email or another account",
      "Friends are getting strange emails from you",
      "You've forgotten passwords, or use the same one everywhere",
      "You want to check whether an email or text is a scam",
      "You'd like passkeys or two-step sign-in set up",
      "You'd like your social media set to private",
    ],
    visitSteps: [
      "I check the device and accounts involved and work out what actually happened. Often it's less serious than it looks.",
      "I remove anything harmful and change the passwords on any account that might be affected.",
      "I set up protection that suits you, like saved passwords, two-step sign-in or passkeys.",
      "I show you the signs to watch for, so the next scam is easier to spot.",
    ],
    typicalTime:
      "Checking a scam or clearing a fake virus warning is often quick. Changing the passwords on all your accounts takes longer, sometimes a few hours, depending on how many you have.",
    example:
      "A customer's computer was showing fake virus warnings meant to scare them into calling a number. I removed the scareware and cleaned the computer with Malwarebytes.",
    reviewIds: [],
    faqs: [
      {
        q: "I think I've been scammed. What should I do first?",
        a: "If you gave out bank or card details, call your bank straight away so they can stop payments. Don't call any number a pop-up shows you. Then book a visit and I'll check your devices and accounts.",
      },
      {
        q: "Do I need to pay for antivirus?",
        a: "For most people, no. Windows and Macs have good protection built in. I'll check yours is switched on and up to date, and tell you if anything you already pay for isn't worth keeping.",
      },
      {
        q: "Will you ever call me out of the blue?",
        a: "No. I'll never phone you out of the blue to say there's a problem with your computer. Anyone who does is a scammer.",
      },
    ],
    related: ["setup-transfer", "wifi-internet"],
  },
};

/** Slugs with a detail page, in SERVICE_AREAS order so lists match /services. */
export const SERVICE_PAGE_SLUGS: ReadonlyArray<ServicePageSlug> = SERVICE_AREAS.map(
  (a) => a.slug,
).filter(hasServicePage);

/**
 * Whether a category has a detail page; own keys only, so "toString" can't pass.
 * @param slug - A SERVICE_AREAS slug or a route param.
 * @returns True when {@link SERVICE_PAGES} has content for it.
 */
export function hasServicePage(slug: string): slug is ServicePageSlug {
  return Object.hasOwn(SERVICE_PAGES, slug);
}

/**
 * Where a service category link goes: its own page if it has one, else its /services card.
 * @param slug - A SERVICE_AREAS slug.
 * @returns `/services/<slug>` or `/services#<slug>`.
 */
export function serviceHref(slug: string): string {
  return hasServicePage(slug) ? `/services/${slug}` : `/services#${slug}`;
}
