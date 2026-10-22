"use client";
// src/features/social/components/SocialTabs.tsx
// The Social pages' tab strip: Overview, Posts, Calendar, Content, Schedules, Inbox and
// Analytics. Links, so the address is the source of truth.

import { AdminTabs } from "@/features/admin/components/ui/AdminTabs";
import {
  SOCIAL_ANALYTICS_PATH,
  SOCIAL_CALENDAR_PATH,
  SOCIAL_CONTENT_PATH,
  SOCIAL_INBOX_PATH,
  SOCIAL_OVERVIEW_PATH,
  SOCIAL_POSTS_PATH,
  SOCIAL_SCHEDULES_PATH,
} from "@/features/social/lib/links";
import { usePathname } from "next/navigation";
import type React from "react";

type SocialTabKey =
  "overview" | "posts" | "calendar" | "content" | "schedules" | "inbox" | "analytics";

const TABS = [
  { key: "overview", label: "Overview", href: SOCIAL_OVERVIEW_PATH },
  { key: "posts", label: "Posts", href: SOCIAL_POSTS_PATH },
  { key: "calendar", label: "Calendar", href: SOCIAL_CALENDAR_PATH },
  { key: "content", label: "Content", href: SOCIAL_CONTENT_PATH },
  { key: "schedules", label: "Schedules", href: SOCIAL_SCHEDULES_PATH },
  { key: "inbox", label: "Inbox", href: SOCIAL_INBOX_PATH },
  { key: "analytics", label: "Analytics", href: SOCIAL_ANALYTICS_PATH },
] as const;

/**
 * Social tab strip; a content item's or schedule's own page counts as its tab.
 * @returns The tablist element.
 */
export function SocialTabs(): React.ReactElement {
  const pathname = usePathname();
  const active: SocialTabKey =
    pathname === SOCIAL_OVERVIEW_PATH
      ? "overview"
      : pathname.startsWith(SOCIAL_CONTENT_PATH)
        ? "content"
        : pathname.startsWith(SOCIAL_SCHEDULES_PATH)
          ? "schedules"
          : pathname.startsWith(SOCIAL_CALENDAR_PATH)
            ? "calendar"
            : pathname.startsWith(SOCIAL_ANALYTICS_PATH)
              ? "analytics"
              : pathname.startsWith(SOCIAL_INBOX_PATH)
                ? "inbox"
                : "posts";
  return <AdminTabs aria-label="Social" tabs={TABS} active={active} className="mb-6" />;
}
