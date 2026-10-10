"use client";
// src/features/social/components/PostPreviewPanel.tsx
// The composer's preview column: a look-alike Facebook or Instagram card for each enabled
// platform, its fix-first and note lines, and a switch between platforms. From xl it
// pins beside the form, clearing the admin top bar and, on drafts, the pinned action bar.

import {
  FacebookPreview,
  InstagramPreview,
  type PreviewPost,
} from "@/features/social/components/PlatformPreview";
import type { ComposerPane } from "@/features/social/components/PostPaneTabs";
import { PLATFORM_LABEL, type Issue, type SocialPlatformKey } from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Preview column.
 * @param props - Component props.
 * @param props.pane - Which pane shows below xl; the preview hides while writing.
 * @param props.belowActionBar - Whether the pinned action bar sits above it from xl.
 * @param props.enabled - Platforms the post goes to.
 * @param props.shownPreview - Platform whose card shows, or null when none is picked.
 * @param props.onPreviewOn - Switches the card to another platform.
 * @param props.issues - Problems per platform from the publishing rules.
 * @param props.previewOf - Builds one platform's card content.
 * @param props.accounts - Real Page name and username, once the connection check answers.
 * @returns Preview section element.
 */
export function PostPreviewPanel({
  pane,
  belowActionBar,
  enabled,
  shownPreview,
  onPreviewOn,
  issues,
  previewOf,
  accounts,
}: {
  pane: ComposerPane;
  belowActionBar: boolean;
  enabled: SocialPlatformKey[];
  shownPreview: SocialPlatformKey | null;
  onPreviewOn: (p: SocialPlatformKey) => void;
  issues: Partial<Record<SocialPlatformKey, Issue[]>>;
  previewOf: (p: SocialPlatformKey) => PreviewPost;
  accounts: Partial<Record<SocialPlatformKey, string>>;
}): React.ReactElement {
  return (
    <section
      aria-label="Preview"
      className={cn(
        "flex-col gap-3 rounded-lg border border-admin-border bg-admin-surface p-4 xl:sticky xl:flex xl:overflow-y-auto",
        // Clear the pinned action bar when there is one (drafts and presets).
        belowActionBar
          ? "xl:top-42 xl:max-h-[calc(100dvh-11.5rem)]"
          : "xl:top-20 xl:max-h-[calc(100dvh-6.5rem)]",
        pane === "write" ? "hidden" : "flex",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-admin-text">Preview</h2>
        {enabled.length > 1 && (
          <div
            role="tablist"
            aria-label="Preview for"
            className="inline-flex gap-0.5 rounded-lg border border-admin-border bg-admin-bg p-0.5"
          >
            {enabled.map((p) => {
              const errors = (issues[p] ?? []).filter((i) => i.level === "error").length;
              return (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={p === shownPreview}
                  onClick={() => onPreviewOn(p)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors pointer-coarse:min-h-11",
                    p === shownPreview
                      ? "bg-admin-surface text-admin-text shadow-sm"
                      : "text-admin-muted hover:text-admin-text",
                  )}
                >
                  {PLATFORM_LABEL[p]}
                  {errors > 0 && (
                    <span className="rounded-full bg-red-600 px-1.5 text-sm leading-5 text-white">
                      {errors}
                      <span className="sr-only"> to fix</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {shownPreview === null ? (
        <p className="text-sm text-admin-muted">Pick where to post to see a preview.</p>
      ) : (
        <>
          <div className="rounded-lg bg-[#f0f2f5] p-3">
            {shownPreview === "facebook" ? (
              <FacebookPreview
                post={previewOf("facebook")}
                pageName={accounts.facebook ?? "Your Page"}
              />
            ) : (
              <InstagramPreview
                post={previewOf("instagram")}
                username={(accounts.instagram ?? "your.account").replace(/^@/, "")}
              />
            )}
          </div>
          {(issues[shownPreview] ?? []).length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {(issues[shownPreview] ?? []).map((i) => (
                <li
                  key={i.message}
                  className={i.level === "error" ? "text-red-700" : "text-amber-800"}
                >
                  {i.level === "error" ? "Fix: " : "Note: "}
                  {i.message}
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-admin-muted">Likes and comments are for show.</p>
        </>
      )}
    </section>
  );
}
