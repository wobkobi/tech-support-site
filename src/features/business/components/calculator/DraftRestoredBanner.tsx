"use client";
// src/features/business/components/calculator/DraftRestoredBanner.tsx
// Banner shown when the calculator reloads a saved draft, with a Discard action that
// resets the form.

import { timeAgo } from "@/features/business/lib/calculator-draft";
import type React from "react";

interface Props {
  draftRestoredAt: number;
  mountedAt: number;
  onDiscard: () => void;
}

/**
 * "Draft restored" banner. It sits above the calculator grid so Discard is in
 * view without scrolling on a phone, where cached values otherwise look like a
 * mystery pre-filled form.
 * @param props - Component props.
 * @param props.draftRestoredAt - When the restored draft was last edited.
 * @param props.mountedAt - When the calculator mounted, the "now" for the relative time.
 * @param props.onDiscard - Throws the draft away and resets the form.
 * @returns Banner element.
 */
export function DraftRestoredBanner({
  draftRestoredAt,
  mountedAt,
  onDiscard,
}: Props): React.ReactElement {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-admin-border bg-admin-bg px-4 py-2 text-sm text-admin-text">
      <span>Draft restored - last edited {timeAgo(draftRestoredAt, mountedAt)}.</span>
      <button
        type="button"
        onClick={onDiscard}
        className="font-semibold text-russian-violet underline underline-offset-2 hover:text-russian-violet/80"
      >
        Discard
      </button>
    </div>
  );
}
