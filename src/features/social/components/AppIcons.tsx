// src/features/social/components/AppIcons.tsx
// Small Facebook, Instagram and Google marks for the apps a post goes to, in a steady order.

import {
  PLATFORM_LABEL,
  SOCIAL_PLATFORMS,
  type SocialPlatformKey,
} from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { FaFacebook, FaGoogle, FaInstagram } from "react-icons/fa6";

const ICON = { facebook: FaFacebook, instagram: FaInstagram, google: FaGoogle } as const;

/**
 * App marks.
 * @param props - Component props.
 * @param props.platforms - The apps.
 * @param props.className - Extra classes.
 * @returns The marks, named for screen readers.
 */
export function AppIcons({
  platforms,
  className,
}: {
  platforms: readonly SocialPlatformKey[];
  className?: string;
}): React.ReactElement | null {
  const on = SOCIAL_PLATFORMS.filter((p) => platforms.includes(p));
  if (on.length === 0) return null;
  return (
    <span
      role="img"
      aria-label={on.map((p) => PLATFORM_LABEL[p]).join(", ")}
      className={cn("inline-flex shrink-0 items-center gap-1", className)}
    >
      {on.map((p) => {
        const Icon = ICON[p];
        return <Icon key={p} aria-hidden className="size-3.5" />;
      })}
    </span>
  );
}
