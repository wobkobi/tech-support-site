// src/features/business/lib/tax/asset-classes.ts
// IR265 (March 2026) depreciation classes this business uses; rates can be overridden per asset.
// Full list: https://www.ird.govt.nz/rate-finder

import type { AssetClass } from "@/features/business/lib/tax/types";

/** Class key of the motor vehicle class: the only class a km-rate vehicle can use. */
export const VEHICLE_CLASS_KEY = "vehicle";

/** Built-in IR265 subset, in picker order. Rates are fractions. */
export const ASSET_CLASSES: readonly AssetClass[] = [
  // IR265 has no monitor row, so monitors sit under computer equipment.
  {
    key: "computer",
    label: "Computer, laptop or monitor",
    group: "Computers and phones",
    dv: 0.5,
    sl: 0.4,
    lifeYears: 4,
  },
  {
    key: "networking",
    label: "Disk drive, router, modem or scanner",
    group: "Computers and phones",
    dv: 0.5,
    sl: 0.4,
    lifeYears: 4,
  },
  {
    key: "printer",
    label: "Printer",
    group: "Computers and phones",
    dv: 0.4,
    sl: 0.3,
    lifeYears: 5,
  },
  {
    key: "ups-cabling",
    label: "UPS or cabling",
    group: "Computers and phones",
    dv: 0.3,
    sl: 0.21,
    lifeYears: 6.66,
  },
  {
    key: "tablet",
    label: "Tablet",
    group: "Computers and phones",
    dv: 0.67,
    sl: 0.67,
    lifeYears: 3,
  },
  {
    key: "phone",
    label: "Mobile phone",
    group: "Computers and phones",
    dv: 0.67,
    sl: 0.67,
    lifeYears: 3,
  },
  {
    key: "furniture-chair",
    label: "Chair or other office furniture",
    group: "Furniture and office",
    dv: 0.16,
    sl: 0.105,
    lifeYears: 12.5,
  },
  {
    key: "desk",
    label: "Desk or table",
    group: "Furniture and office",
    dv: 0.13,
    sl: 0.085,
    lifeYears: 15.5,
  },
  {
    key: "office-equipment",
    label: "Other office equipment",
    group: "Furniture and office",
    dv: 0.4,
    sl: 0.3,
    lifeYears: 5,
  },
  {
    key: "test-equipment",
    label: "Electrical test equipment",
    group: "Tools and test gear",
    dv: 0.25,
    sl: 0.175,
    lifeYears: 8,
  },
  {
    key: "loose-tools",
    label: "Loose tools",
    group: "Tools and test gear",
    dv: 0.67,
    sl: 0.67,
    lifeYears: 3,
  },
  {
    key: "hand-instruments",
    label: "Hand-held instrument",
    group: "Tools and test gear",
    dv: 0.4,
    sl: 0.3,
    lifeYears: 5,
  },
  {
    key: VEHICLE_CLASS_KEY,
    label: "Car or van (up to 12 seats)",
    group: "Vehicles",
    dv: 0.3,
    sl: 0.21,
    lifeYears: 5,
  },
  {
    key: "software",
    label: "Software bought outright",
    group: "Software",
    dv: 0.5,
    sl: 0.4,
    lifeYears: 4,
  },
];

/**
 * Looks up a built-in class.
 * @param key - Class key stored on the asset, e.g. "computer".
 * @returns The class, or undefined for an unknown key.
 */
export function assetClassByKey(key: string): AssetClass | undefined {
  return ASSET_CLASSES.find((c) => c.key === key);
}
