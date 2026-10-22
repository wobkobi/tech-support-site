// src/app/admin/(shell)/social/(hub)/inbox/page.tsx
// Admin Social Inbox tab: comments on Facebook and Instagram posts, Google reviews, and Messenger
// and Instagram messages, read by the sync. `?tab=archive`, `?filter=`, `?app=`, `?show=` and
// `?q=` pick the list, and `?open=` the thread.

import { parseObjectId } from "@/features/business/lib/validation";
import { InboxView } from "@/features/social/components/InboxView";
import { loadInbox } from "@/features/social/lib/inbox/inbox-data.server";
import { readInboxQuery } from "@/features/social/lib/inbox/map";
import { aiConfigured } from "@/shared/lib/ai/json-completion";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Social inbox - Admin",
  robots: { index: false, follow: false },
};

/** The address's params. */
type InboxParams = Record<
  "tab" | "filter" | "app" | "show" | "q" | "open",
  string | string[] | undefined
>;

/**
 * A param's single value; a repeated param counts as none.
 * @param value - The raw param.
 * @returns The value, or undefined.
 */
function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Admin Social Inbox page.
 * @param props - Page props.
 * @param props.searchParams - `tab`, `filter`, `app`, `show`, `q` and `open`.
 * @returns Inbox page element.
 */
export default async function AdminSocialInboxPage({
  searchParams,
}: {
  searchParams: Promise<Partial<InboxParams>>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const params = await searchParams;
  const query = readInboxQuery({
    tab: one(params.tab),
    filter: one(params.filter),
    app: one(params.app),
    show: one(params.show),
    q: one(params.q),
  });
  const open = parseObjectId(one(params.open));
  const [data, reviewTemplate] = await Promise.all([
    loadInbox(query, open),
    // Make a post from this review starts from the newest review template.
    prisma.socialDesign.findFirst({
      where: { isTemplate: true, kind: "review" },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    }),
  ]);
  return (
    <InboxView
      data={data}
      query={query}
      now={new Date().toISOString()}
      canSuggest={aiConfigured()}
      reviewTemplateId={reviewTemplate?.id ?? null}
    />
  );
}
