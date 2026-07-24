// src/shared/components/Skeleton.tsx
/**
 * @description Shared loading-skeleton primitive ("bone") used by route-level
 * loading.tsx files so every page streams a placeholder in the same visual
 * language instead of a blank frame.
 */

import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Props for Bone. */
interface BoneProps {
  /** Sizing/positioning classes (width, height, rounding, opacity). */
  className?: string;
}

/**
 * Animated placeholder block that fills a skeleton layout while a route loads.
 * Tuned for the light public theme; the admin skeleton passes its own slate
 * tone via className overrides.
 * @param props - Component props.
 * @param props.className - Sizing/positioning classes.
 * @returns Skeleton bone element.
 */
export function Bone({ className }: BoneProps): React.ReactElement {
  return <div className={cn("animate-pulse rounded-lg bg-seasalt-200/50", className)} />;
}
