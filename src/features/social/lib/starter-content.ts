// src/features/social/lib/starter-content.ts
// The starter content set Import starter content adds to the library: evergreen tips, scam
// warnings, a little about me, a review ask and two seasonal posts, each with captions that take
// turns. Pure and client-safe; starter-content.server.ts does the import.

import { tagKey } from "@/features/social/lib/tags";
import { defaultTargets, type TargetState } from "@/features/social/lib/targets";
import type { GooglePostCta } from "@/features/social/lib/validate";

/** Where a starter item's link goes. */
type StarterLink = "booking" | "about" | "review" | null;

/** One starter content item. */
export interface StarterItem {
  /** Stable key stored as starterKey, so importing again skips it. */
  key: string;
  name: string;
  /** Two or three captions; the first is the body. */
  captions: string[];
  /** Tag names, made when missing. */
  tags: string[];
  link: StarterLink;
  /** Google's button: Book for the booking page, Learn more for other pages, Call now with no link. */
  googleCta: GooglePostCta | null;
  /** Evergreen items post again and again; seasonal ones only once. */
  recycle: boolean;
}

/** The addresses the starter links point at. */
export interface StarterLinks {
  booking: string;
  about: string;
  /** The Google review box, or the site's own review page when that isn't set. */
  review: string;
}

/**
 * Paragraphs joined with a blank line between, as the apps show them.
 * @param paragraphs - The caption's paragraphs.
 * @returns The caption.
 */
function caption(...paragraphs: string[]): string {
  return paragraphs.join("\n\n");
}

const TIP = "Tech tip";
const SCAM = "Scam warning";
const ABOUT = "About me";
const REVIEWS = "Reviews";
const SEASONAL = "Seasonal";

/** The starter set, in the order it's added. */
export const STARTER_CONTENT: readonly StarterItem[] = [
  {
    key: "tip-updates",
    name: "Tech tip: say yes to updates",
    captions: [
      caption(
        "Quick tip: when your phone or computer asks to update, say yes.",
        "Updates aren't just new features. Most of them close security holes that scammers already know about, so putting them off leaves the door open.",
        "If updates keep failing, or you're not sure what's safe to install, book a time and I'll sort it out with you.",
      ),
      caption(
        'That "update available" message is worth tapping.',
        "Most updates fix security problems, and the older your software gets, the easier it is for scammers to get in. Plug your phone in overnight and let it update while you sleep.",
        "Stuck on an update that won't finish? Book a time and I'll help.",
      ),
      caption(
        "Putting off updates? Here's why they're worth doing.",
        "Every update patches holes found since the last one. Leaving them for months is like leaving a window open because closing it takes a minute.",
        "Book a visit if you'd like me to check everything's up to date.",
      ),
    ],
    tags: [TIP],
    link: "booking",
    googleCta: "BOOK",
    recycle: true,
  },
  {
    key: "tip-passwords",
    name: "Tech tip: a password manager",
    captions: [
      caption(
        "Using the same password everywhere? You're not alone, but it's risky.",
        "When one website gets hacked, scammers try that email and password on every other site. A password manager keeps a different strong password for each one, so you only need to remember one.",
        "I can set one up with you and move your passwords across.",
      ),
      caption(
        "Quick tip: let a password manager do the remembering.",
        "It keeps a different, strong password for every site and fills it in for you. Your phone or computer may already have one built in.",
        "Want a hand getting it set up? Book a time and I'll walk you through it.",
      ),
    ],
    tags: [TIP],
    link: "booking",
    googleCta: "BOOK",
    recycle: true,
  },
  {
    key: "tip-photo-backup",
    name: "Tech tip: back up your photos",
    captions: [
      caption(
        "If your phone was lost tomorrow, would your photos go with it?",
        "Turning on a photo backup takes a few minutes. After that, every new photo is copied somewhere safe without you doing anything.",
        "Not sure if yours is on? Book a time and I'll check it with you.",
      ),
      caption(
        "Quick tip: check your photos are backed up before you need them.",
        "Phones get dropped, lost and stolen. With a backup, a new phone can have every photo back on it the same day.",
        "I can set it up and show you how to check it's working.",
      ),
    ],
    tags: [TIP],
    link: "booking",
    googleCta: "BOOK",
    recycle: true,
  },
  {
    key: "tip-two-step",
    name: "Tech tip: two-step sign-in",
    captions: [
      caption(
        "Quick tip: turn on two-step sign-in for your email.",
        "When someone signs in from a new device, they also need a code from your phone. Even if a scammer gets your password, they can't get in without it.",
        "Your email matters most, because it's how every other password gets reset. Book a time and I'll turn it on with you.",
      ),
      caption(
        "A password on its own isn't enough any more.",
        "Two-step sign-in sends a code to your phone when someone signs in somewhere new, so a stolen password won't get them in. Start with your email and your bank.",
        "I'm happy to set it up with you.",
      ),
    ],
    tags: [TIP],
    link: "booking",
    googleCta: "BOOK",
    recycle: true,
  },
  {
    key: "tip-slow-computer",
    name: "Tech tip: a slow computer",
    captions: [
      caption(
        "Is your computer getting slower every year?",
        "Before you buy a new one, it's worth a look. Programs that start by themselves, a nearly full drive or an old hard drive are common causes, and most can be fixed for much less than a new computer costs.",
        "Book a visit and I'll tell you honestly whether it's worth fixing.",
      ),
      caption(
        "A slow computer doesn't always mean a new computer.",
        "Often it's too many programs starting up, a full drive, or a part that can be swapped for a faster one. I'll find out what's slowing it down and tell you plainly what's worth doing.",
        "Book a time that suits you.",
      ),
    ],
    tags: [TIP],
    link: "booking",
    googleCta: "BOOK",
    recycle: true,
  },
  {
    key: "tip-wifi",
    name: "Tech tip: patchy Wi-Fi",
    captions: [
      caption(
        "Wi-Fi drops out in some rooms?",
        "Where the router sits makes a big difference. Out in the open and up high works better than in a cupboard or on the floor. Turning it off and on again also fixes more than you'd think.",
        "If it's still patchy, book a visit and I'll find the weak spots and sort them out.",
      ),
      caption(
        "Quick tip: move your router out of the cupboard.",
        "Walls, cupboards and even fish tanks block Wi-Fi. A router in the open, near the middle of the house, reaches more rooms.",
        "Still getting dead spots? I can work out the best fix for your home.",
      ),
    ],
    tags: [TIP],
    link: "booking",
    googleCta: "BOOK",
    recycle: true,
  },
  {
    key: "scam-bank-call",
    name: "Scam warning: calls from your bank",
    captions: [
      caption(
        "Scam warning: people are getting calls from someone saying they're from their bank's fraud team.",
        'They sound convincing and may already know your name. Then they ask you to move money to a "safe account", or to read out a code sent to your phone.',
        "Your bank will never ask for either. Hang up, then ring the number on the back of your card.",
      ),
      caption(
        "If a caller says they're from your bank and asks you to move money, it's a scam.",
        "Real bank staff never ask you to move money to keep it safe, and never ask for the codes they text you. Hang up and call the bank yourself, using the number on your card.",
        "Pass this on to anyone who might get one of these calls.",
      ),
    ],
    tags: [SCAM],
    link: null,
    googleCta: "CALL",
    recycle: true,
  },
  {
    key: "scam-parcel-text",
    name: "Scam warning: parcel texts",
    captions: [
      caption(
        "Scam warning: texts saying a parcel couldn't be delivered.",
        "They ask you to tap a link and pay a small fee to have it delivered again. The link goes to a fake page that takes your card details.",
        "Don't tap the link, just delete the text. If you've already paid, call your bank straight away.",
      ),
      caption(
        "Waiting on a parcel? Be careful with delivery texts.",
        "Scammers send texts that look like they're from a courier, asking for a small fee to deliver again. It's a trick to get your card details.",
        "Couriers don't ask for fees by text. Delete it, and if you've typed in your card number, ring your bank.",
      ),
    ],
    tags: [SCAM],
    link: null,
    googleCta: "CALL",
    recycle: true,
  },
  {
    key: "scam-virus-popup",
    name: "Scam warning: virus pop-ups",
    captions: [
      caption(
        "Scam warning: a pop-up says your computer is infected and gives a number to call.",
        'It\'s fake. The people on the other end want to get into your computer and charge you to "fix" it, or get into your bank.',
        "Don't call the number. Close the browser, and if it won't close, turn the computer off and on again. If you're still worried, get in touch and I'll check it over.",
      ),
      caption(
        "A loud warning on your screen telling you to call for help? It's a scam.",
        "Real virus warnings never give you a phone number to call. Close the page, or restart the computer if it won't go away.",
        "If you did call and let them in, change your passwords and get in touch. I'll check the computer and clean up anything they left behind.",
      ),
    ],
    tags: [SCAM],
    link: null,
    googleCta: "CALL",
    recycle: true,
  },
  {
    key: "scam-renewal-email",
    name: "Scam warning: fake renewal emails",
    captions: [
      caption(
        "Scam warning: emails saying your antivirus or a subscription has renewed for hundreds of dollars.",
        'They want you to call to cancel. Then they ask to get into your computer, or for your card details to give you a "refund".',
        "Don't call the number in the email. To check whether you have that subscription, sign in to the company's real website the way you usually would, or ask me.",
      ),
      caption(
        "Got an email about a big charge for something you don't remember buying?",
        "It's a common scam. The email is written to panic you into calling a number, where they talk you into giving them access to your computer or your card.",
        "Delete it. Anything real will show up when you sign in to your account the usual way.",
      ),
    ],
    tags: [SCAM],
    link: null,
    googleCta: "CALL",
    recycle: true,
  },
  {
    key: "about-me",
    name: "About me",
    captions: [
      caption(
        "Hi, I'm the person behind To the Point Tech.",
        "I help people with computers, phones, Wi-Fi, email and anything else that's stopped doing what it should. I explain things in plain English, at your pace, and I don't sell you anything you don't need.",
        "You can read more about me on my website.",
      ),
      caption(
        "A bit about me and why I do this.",
        "I started To the Point Tech so people have someone friendly and patient to turn to when technology gets in the way. No jargon, no rushing, and you'll know what I did and why.",
        "There's more about me on my website.",
      ),
    ],
    tags: [ABOUT],
    link: "about",
    googleCta: "LEARN_MORE",
    recycle: true,
  },
  {
    key: "about-home-visits",
    name: "About me: I come to you",
    captions: [
      caption(
        "No need to unplug anything and carry it in. I come to your home or business and fix things where you use them.",
        "That way I can see how everything's set up, sort out the Wi-Fi and printer while I'm there, and show you how it all works on your own devices.",
        "Book a time that suits you.",
      ),
      caption(
        "I come to you.",
        "A home visit means your computer, phone, printer and Wi-Fi all get looked at together, set up the way you use them. Some things can be sorted over the internet too, without a visit.",
        "Pick a time online.",
      ),
    ],
    tags: [ABOUT],
    link: "booking",
    googleCta: "BOOK",
    recycle: true,
  },
  {
    key: "about-plain-english",
    name: "About me: no jargon",
    captions: [
      caption(
        "Tech help without the jargon.",
        "I'll explain what's wrong and what I'm doing in plain English, and I'm happy to show you something as many times as it takes. No question is too small.",
        "Book a time when you're ready.",
      ),
      caption(
        "Ever had help with your computer and come away more confused?",
        "I take the time to explain things simply, and I'll write down the steps if you'd like them. You stay in charge of your own devices.",
        "Book online whenever it suits you.",
      ),
    ],
    tags: [ABOUT],
    link: "booking",
    googleCta: "BOOK",
    recycle: true,
  },
  {
    key: "review-ask",
    name: "Ask for a review",
    captions: [
      caption(
        "If I've helped you with your tech, I'd really appreciate a review.",
        "It only takes a minute, and it helps other people find someone they can trust with their computer or phone.",
        "Thank you to everyone who's left one already.",
      ),
      caption(
        "A quick favour to ask.",
        "Reviews make a big difference to a small business like mine. If I've sorted something out for you, I'd love to hear how it went.",
        "The link takes you straight to the review page.",
      ),
    ],
    tags: [REVIEWS],
    link: "review",
    googleCta: "LEARN_MORE",
    recycle: true,
  },
  {
    key: "seasonal-new-phone",
    name: "Christmas: a new phone",
    captions: [
      caption(
        "Getting a new phone or tablet for Christmas?",
        "Moving your photos, contacts, messages and apps across can be fiddly. I can set it up with you, copy everything over and show you the new features you'll actually use.",
        "Book a time that suits you.",
      ),
      caption(
        "Is a new phone or tablet under the tree this year?",
        "I can help get it set up: your contacts, photos, email and banking app all moved over safely, and the old one wiped before it's passed on.",
        "Book a time online.",
      ),
    ],
    tags: [SEASONAL],
    link: "booking",
    googleCta: "BOOK",
    recycle: false,
  },
  {
    key: "seasonal-backup-day",
    name: "31 March: World Backup Day",
    captions: [
      caption(
        "31 March is World Backup Day, a good reminder to check your photos and files are copied somewhere safe.",
        "Ask yourself: if your computer stopped working today, what would you lose? If it's anything you'd miss, it's time to set up a backup.",
        "Book a time and I'll set one up that runs by itself.",
      ),
      caption(
        "World Backup Day is 31 March.",
        "It takes a few minutes to check your backup is working, and a lot longer to try to get files back from a broken computer. Check yours this week.",
        "Not sure how? I can set it up and show you how to check it.",
      ),
    ],
    tags: [SEASONAL],
    link: "booking",
    googleCta: "BOOK",
    recycle: false,
  },
];

/**
 * A starter item as stored, apart from its tags, which need ids. Facebook and Google are on;
 * Instagram stays off until a picture is added, as it won't post without one.
 * @param item - The starter item.
 * @param links - Where its link can point.
 * @returns Fields for the create.
 */
export function starterItemFields(
  item: StarterItem,
  links: StarterLinks,
): {
  name: string;
  body: string;
  altCaptions: string[];
  linkUrl: string | null;
  googleCta: GooglePostCta | null;
  recycle: boolean;
  starterKey: string;
  isContent: true;
  targets: TargetState[];
} {
  const [body = "", ...rest] = item.captions;
  return {
    name: item.name,
    body,
    altCaptions: rest,
    linkUrl: item.link ? links[item.link] : null,
    googleCta: item.googleCta,
    recycle: item.recycle,
    starterKey: item.key,
    isContent: true,
    targets: defaultTargets().map((t) =>
      t.platform === "instagram" ? { ...t, enabled: false } : t,
    ),
  };
}

/** What an import would do. */
export interface StarterPlan {
  /** Items not in the library yet. */
  create: StarterItem[];
  /** Keys of items already there. */
  skipped: string[];
  /** Tag names those items need that don't exist yet, as first written. */
  newTags: string[];
}

/**
 * Works out an import: items whose key is already in the library are skipped, and the tags the
 * rest need are matched to existing ones by {@link tagKey}, so "tech tip" reuses "Tech tip".
 * @param items - The starter set.
 * @param existingKeys - starterKeys already in the library.
 * @param existingTags - Names of every tag there is.
 * @returns The plan.
 */
export function planStarterImport(
  items: readonly StarterItem[],
  existingKeys: ReadonlySet<string>,
  existingTags: readonly string[],
): StarterPlan {
  const create = items.filter((i) => !existingKeys.has(i.key));
  const known = new Set(existingTags.map(tagKey));
  const newTags: string[] = [];
  for (const name of create.flatMap((i) => i.tags)) {
    const key = tagKey(name);
    if (known.has(key)) continue;
    known.add(key);
    newTags.push(name);
  }
  return {
    create,
    skipped: items.filter((i) => existingKeys.has(i.key)).map((i) => i.key),
    newTags,
  };
}
