// src/shared/lib/service-areas.ts
// The service categories, shared by the services page (full cards) and the home
// page's "What I can help with" tiles, which link to /services#<slug>. One list
// keeps a tile's anchor from drifting off its card.

import type { IconType } from "react-icons";
import {
  FaCloud,
  FaEnvelope,
  FaHouse,
  FaImages,
  FaLaptop,
  FaMobileScreen,
  FaPrint,
  FaRightLeft,
  FaShieldHalved,
  FaToolbox,
  FaTv,
  FaWifi,
} from "react-icons/fa6";

/** One service category. */
export interface ServiceArea {
  /** Anchor id of the category's card on /services. */
  slug: string;
  /** Card heading on /services; also the JSON-LD service name. */
  label: string;
  /** Shorter tile label on the home page. */
  homeLabel: string;
  /** One-line description under the label on the home page's services list. */
  blurb: string;
  icon: IconType;
  examples: ReadonlyArray<string>;
}

export const SERVICE_AREAS: ReadonlyArray<ServiceArea> = [
  {
    slug: "computers-laptops",
    label: "Computers & Laptops",
    homeLabel: "Computers & Laptops",
    blurb: "Slow, broken or won't start",
    icon: FaLaptop,
    examples: ["Slow PC investigation", "Software installs", "Virus cleanup", "General tune-ups"],
  },
  {
    slug: "phones-tablets",
    label: "Phones & Tablets",
    homeLabel: "Phones & Tablets",
    blurb: "Setup, fixes, moving to a new one",
    icon: FaMobileScreen,
    examples: ["New device setup", "Data transfer", "App help", "Account sync"],
  },
  {
    slug: "wifi-internet",
    label: "Wi-Fi & Internet",
    homeLabel: "Wi-Fi & Networks",
    blurb: "Dead spots, dropouts, new routers",
    icon: FaWifi,
    examples: ["Fixing dropouts", "Extending coverage", "Router setup", "Speed issues"],
  },
  {
    slug: "tv-streaming",
    label: "TV & Streaming",
    homeLabel: "Smart TVs",
    blurb: "Smart TVs, apps, casting",
    icon: FaTv,
    examples: ["Smart TV setup", "Streaming apps", "Chromecast/AirPlay", "Sound systems"],
  },
  {
    slug: "smart-home",
    label: "Smart Home",
    homeLabel: "Smart Home",
    blurb: "Speakers, cameras, doorbells",
    icon: FaHouse,
    examples: ["Smart lights", "Security cameras", "Voice assistants", "App setup"],
  },
  {
    slug: "printers-scanners",
    label: "Printers & Scanners",
    homeLabel: "Printers",
    blurb: "Won't print, won't connect",
    icon: FaPrint,
    examples: ["Getting online", "Driver issues", "Network printing", "Scan setup"],
  },
  {
    slug: "cloud-backups",
    label: "Cloud & Backups",
    homeLabel: "Cloud & Backups",
    blurb: "So nothing gets lost",
    icon: FaCloud,
    examples: ["OneDrive/iCloud/Google", "External drives", "Auto-backup setup", "Recovery"],
  },
  {
    slug: "photos-storage",
    label: "Photos & Storage",
    homeLabel: "Photo Storage",
    blurb: "Sorting, saving, freeing up space",
    icon: FaImages,
    examples: ["Organising photos", "Freeing space", "Photo backup", "File management"],
  },
  {
    slug: "setup-transfer",
    label: "Setup & Transfer",
    homeLabel: "Data Transfer",
    blurb: "New computer, old files moved over",
    icon: FaRightLeft,
    examples: ["New device migration", "Old to new PC", "Email setup", "Account moves"],
  },
  {
    slug: "tune-ups-repairs",
    label: "Tune-ups & Repairs",
    homeLabel: "Repairs",
    blurb: "Speed-ups, parts, clean-ups",
    icon: FaToolbox,
    examples: ["Speed improvements", "Update installs", "Cleanup", "Basic repairs"],
  },
  {
    slug: "security",
    label: "Security",
    homeLabel: "Security",
    blurb: "Scams, viruses, passwords",
    icon: FaShieldHalved,
    examples: ["Password help", "Scam removal", "Safety checks", "Secure setup"],
  },
  {
    slug: "email-accounts",
    label: "Email & Accounts",
    homeLabel: "Email Setup",
    blurb: "Setup, recovery, moving over",
    icon: FaEnvelope,
    examples: ["Email setup", "Password recovery", "Account sync", "Spam filtering"],
  },
];
