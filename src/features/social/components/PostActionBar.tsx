"use client";
// src/features/social/components/PostActionBar.tsx
// The composer's save-and-post bar: where autosave is at, whether the post is ready, and
// Schedule / Post now. The composer places it twice, pinned under the top bar on wide
// screens and to the bottom on narrower ones, so it holds no state of its own.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ADMIN_LINK_CLS } from "@/features/admin/components/ui/field-classes";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Autosave state shown in the bar. */
export type PostSaveState = "saved" | "unsaved" | "saving" | "error";

/**
 * Save state, readiness and the post buttons.
 * @param props - Component props.
 * @param props.saveState - Where autosave is at.
 * @param props.onRetrySave - Saves again after a failed save.
 * @param props.isPreset - Presets aren't posted, so they get a note instead of buttons.
 * @param props.readyMessage - What still stops the post going out, or "Ready to post.".
 * @param props.showProblem - Whether the ready line reads as a problem (red).
 * @param props.scheduleDisabled - Whether Schedule is off.
 * @param props.postDisabled - Whether Post now is off.
 * @param props.posting - Whether Post now is running.
 * @param props.onSchedule - Opens the schedule dialog.
 * @param props.onPostNow - Asks to confirm posting now.
 * @returns Action bar element.
 */
export function PostActionBar({
  saveState,
  onRetrySave,
  isPreset,
  readyMessage,
  showProblem,
  scheduleDisabled,
  postDisabled,
  posting,
  onSchedule,
  onPostNow,
}: {
  saveState: PostSaveState;
  onRetrySave: () => void;
  isPreset: boolean;
  readyMessage: string | undefined;
  showProblem: boolean;
  scheduleDisabled: boolean;
  postDisabled: boolean;
  posting: boolean;
  onSchedule: () => void;
  onPostNow: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-admin-border bg-admin-surface py-3 pr-20 pl-4 shadow-sm sm:flex-row sm:items-center sm:justify-between lg:pr-4">
      <div className="min-w-0 text-sm" aria-live="polite">
        <p
          className={cn("font-medium", saveState === "error" ? "text-red-700" : "text-admin-text")}
        >
          {saveState === "saving" && "Saving..."}
          {saveState === "saved" && "All changes saved"}
          {saveState === "unsaved" && "Unsaved changes"}
          {saveState === "error" && (
            <>
              Couldn&apos;t save.{" "}
              <button type="button" onClick={onRetrySave} className={cn("text-sm", ADMIN_LINK_CLS)}>
                Try again
              </button>
            </>
          )}
        </p>
        <p className={cn(showProblem ? "text-red-700" : "text-admin-muted")}>
          {isPreset
            ? "Presets aren't posted. Press Write a post from this to start one from it."
            : readyMessage}
        </p>
      </div>
      {!isPreset && (
        <div className="flex shrink-0 flex-wrap gap-2">
          <AdminButton variant="secondary" disabled={scheduleDisabled} onClick={onSchedule}>
            Schedule
          </AdminButton>
          <AdminButton busy={posting} disabled={postDisabled} onClick={onPostNow}>
            Post now
          </AdminButton>
        </div>
      )}
    </div>
  );
}
