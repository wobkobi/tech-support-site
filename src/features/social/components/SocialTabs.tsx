"use client";
// src/features/social/components/SocialTabs.tsx
// The Social pages' tab strip: Posts, Content and Schedules. Links, so the address is the source
// of truth.

import { AdminTabs } from "@/features/admin/components/ui/AdminTabs";
import {
  SOCIAL_CONTENT_PATH,
  SOCIAL_POSTS_PATH,
  SOCIAL_SCHEDULES_PATH,
} from "@/features/social/lib/links";
import { usePathname } from "next/navigation";
import type React from "react";

type SocialTabKey = "posts" | "content" | "schedules";

const TABS = [
  { key: "posts", label: "Posts", href: SOCIAL_POSTS_PATH },
  { key: "content", label: "Content", href: SOCIAL_CONTENT_PATH },
  { key: "schedules", label: "Schedules", href: SOCIAL_SCHEDULES_PATH },
] as const;

/**
 * Social tab strip; a content item's or schedule's own page counts as its tab.
 * @returns The tablist element.
 */
export function SocialTabs(): React.ReactElement {
  const pathname = usePathname();
  const active: SocialTabKey = pathname.startsWith(SOCIAL_CONTENT_PATH)
    ? "content"
    : pathname.startsWith(SOCIAL_SCHEDULES_PATH)
      ? "schedules"
      : "posts";
  return <AdminTabs aria-label="Social" tabs={TABS} active={active} className="mb-6" />;
}
