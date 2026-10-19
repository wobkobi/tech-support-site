// src/features/social-design/lib/icons.ts
// The post maker's hand-picked Font Awesome 6 icon names; names only, so the checker can reject
// unknown icons without loading artwork (icon-art.tsx maps them to components).

/** One icon on offer. */
export interface IconChoice {
  name: string;
  label: string;
}

export const ICON_CHOICES: readonly IconChoice[] = [
  { name: "FaLaptop", label: "Laptop" },
  { name: "FaDesktop", label: "Computer" },
  { name: "FaMobileScreen", label: "Phone" },
  { name: "FaTabletScreenButton", label: "Tablet" },
  { name: "FaTv", label: "TV" },
  { name: "FaPrint", label: "Printer" },
  { name: "FaWifi", label: "Wi-Fi" },
  { name: "FaRoute", label: "Router" },
  { name: "FaHardDrive", label: "Hard drive" },
  { name: "FaDatabase", label: "Backup" },
  { name: "FaCloud", label: "Cloud" },
  { name: "FaEnvelope", label: "Email" },
  { name: "FaShieldHalved", label: "Security" },
  { name: "FaLock", label: "Lock" },
  { name: "FaKey", label: "Password" },
  { name: "FaBug", label: "Virus" },
  { name: "FaRotate", label: "Update" },
  { name: "FaGear", label: "Settings" },
  { name: "FaScrewdriverWrench", label: "Repair" },
  { name: "FaBolt", label: "Fast" },
  { name: "FaCamera", label: "Camera" },
  { name: "FaVideo", label: "Video call" },
  { name: "FaGamepad", label: "Gaming" },
  { name: "FaHeadset", label: "Help" },
  { name: "FaComments", label: "Chat" },
  { name: "FaHouse", label: "Home" },
  { name: "FaBuilding", label: "Business" },
  { name: "FaCar", label: "Call-out" },
  { name: "FaLocationDot", label: "Location" },
  { name: "FaCalendarCheck", label: "Booking" },
  { name: "FaClock", label: "Time" },
  { name: "FaCircleCheck", label: "Tick" },
  { name: "FaThumbsUp", label: "Thumbs up" },
  { name: "FaHeart", label: "Heart" },
  { name: "FaLightbulb", label: "Tip" },
  { name: "FaGift", label: "Gift" },
  { name: "FaTag", label: "Price" },
  { name: "FaPercent", label: "Discount" },
];

const NAMES = new Set(ICON_CHOICES.map((c) => c.name));

/**
 * Whether an icon name is one the post maker offers.
 * @param name - Component name.
 * @returns True for a known icon.
 */
export function isIconName(name: string): boolean {
  return NAMES.has(name);
}
