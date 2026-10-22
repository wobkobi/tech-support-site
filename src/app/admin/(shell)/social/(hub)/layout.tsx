// src/app/admin/(shell)/social/(hub)/layout.tsx
// The Social pages' shared header and tabs. The Post maker sits outside this group so it keeps
// the whole screen. Auth stays per-page, as in the (shell) layout.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { SocialTabs } from "@/features/social/components/SocialTabs";
import type React from "react";
import { FaPalette } from "react-icons/fa6";

/**
 * Renders the header and tabs above a Social page.
 * @param props - Layout props.
 * @param props.children - The active Social page.
 * @returns The layout element.
 */
export default function SocialHubLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Social"
        description="Write a post once and send it to Facebook, Instagram and Google, now or at a set time. Keep posts you'll use again as content."
        actions={
          <AdminButton href="/admin/social/design" variant="outline">
            <FaPalette aria-hidden className="size-3.5" /> Post maker
          </AdminButton>
        }
      />
      <SocialTabs />
      {children}
    </>
  );
}
