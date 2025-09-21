// src/lib/cn.ts
/**
 * @file cn.ts
 * @description
 * Merge conditional class names with Tailwind conflict resolution.
 */

import clsx, { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Utility function to merge class names using clsx and tailwind-merge.
 * @param inputs - Class names to be merged.
 * @returns Merged class names as a single string.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
