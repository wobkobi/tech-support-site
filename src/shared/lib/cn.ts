// src/shared/lib/cn.ts
/**
 * @description Merge conditional class names with Tailwind conflict resolution.
 */

import clsx, { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names with Tailwind conflict resolution (later classes win).
 * @param inputs - Class values to merge.
 * @returns Merged class string.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
