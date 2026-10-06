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
  icon: IconType;
  examples: ReadonlyArray<string>;
}

export const SERVICE_AREAS: ReadonlyArray<ServiceArea> = [
  {
    slug: "computers-laptops",
    label: "Computers & Laptops",
    homeLabel: "Computers & Laptops",
    icon: FaLaptop,
    examples: ["Slow PC investigation", "Software installs", "Virus cleanup", "General tune-ups"],
  },
  {
    slug: "phones-tablets",
    label: "Phones & Tablets",
    homeLabel: "Phones & Tablets",
    icon: FaMobileScreen,
    examples: ["New device setup", "Data transfer", "App help", "Account sync"],
  },
  {
    slug: "wifi-internet",
    label: "Wi-Fi & Internet",
    homeLabel: "Wi-Fi & Networks",
    icon: FaWifi,
    examples: ["Fixing dropouts", "Extending coverage", "Router setup", "Speed issues"],
  },
  {
    slug: "tv-streaming",
    label: "TV & Streaming",
    homeLabel: "Smart TVs",
    icon: FaTv,
    examples: ["Smart TV setup", "Streaming apps", "Chromecast/AirPlay", "Sound systems"],
  },
  {
    slug: "smart-home",
    label: "Smart Home",
    homeLabel: "Smart Home",
    icon: FaHouse,
    examples: ["Smart lights", "Security cameras", "Voice assistants", "App setup"],
  },
  {
    slug: "printers-scanners",
    label: "Printers & Scanners",
    homeLabel: "Printers",
    icon: FaPrint,
    examples: ["Getting online", "Driver issues", "Network printing", "Scan setup"],
  },
  {
    slug: "cloud-backups",
    label: "Cloud & Backups",
    homeLabel: "Cloud & Backups",
    icon: FaCloud,
    examples: ["OneDrive/iCloud/Google", "External drives", "Auto-backup setup", "Recovery"],
  },
  {
    slug: "photos-storage",
    label: "Photos & Storage",
    homeLabel: "Photo Storage",
    icon: FaImages,
    examples: ["Organising photos", "Freeing space", "Photo backup", "File management"],
  },
  {
    slug: "setup-transfer",
    label: "Setup & Transfer",
    homeLabel: "Data Transfer",
    icon: FaRightLeft,
    examples: ["New device migration", "Old to new PC", "Email setup", "Account moves"],
  },
  {
    slug: "tune-ups-repairs",
    label: "Tune-ups & Repairs",
    homeLabel: "Repairs",
    icon: FaToolbox,
    examples: ["Speed improvements", "Update installs", "Cleanup", "Basic repairs"],
  },
  {
    slug: "security",
    label: "Security",
    homeLabel: "Security",
    icon: FaShieldHalved,
    examples: ["Password help", "Scam removal", "Safety checks", "Secure setup"],
  },
  {
    slug: "email-accounts",
    label: "Email & Accounts",
    homeLabel: "Email Setup",
    icon: FaEnvelope,
    examples: ["Email setup", "Password recovery", "Account sync", "Spam filtering"],
  },
];
