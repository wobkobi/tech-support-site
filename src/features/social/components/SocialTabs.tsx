"use client";
// src/features/social/components/SocialTabs.tsx
// The Social pages' tab strip: Posts and Content. Links, so the address is the source of truth.

import { AdminTabs } from "@/features/admin/components/ui/AdminTabs";
import { SOCIAL_CONTENT_PATH, SOCIAL_POSTS_PATH } from "@/features/social/lib/links";
import { usePathname } from "next/navigation";
import type React from "react";

type SocialTabKey = "posts" | "content";

const TABS = [
  { key: "posts", label: "Posts", href: SOCIAL_POSTS_PATH },
  { key: "content", label: "Content", href: SOCIAL_CONTENT_PATH },
] as const;

/**
 * Social tab strip; a content item's own page counts as Content.
 * @returns The tablist element.
 */
export function SocialTabs(): React.ReactElement {
  const pathname = usePathname();
  const active: SocialTabKey = pathname.startsWith(SOCIAL_CONTENT_PATH) ? "content" : "posts";
  return <AdminTabs aria-label="Social" tabs={TABS} active={active} className="mb-6" />;
}
