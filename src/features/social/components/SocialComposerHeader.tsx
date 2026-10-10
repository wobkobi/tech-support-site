"use client";
// src/features/social/components/SocialComposerHeader.tsx
// Heading row above the open post on the Social page: its name and status, and the
// post-level actions (write from a preset, duplicate, save as preset, delete, close).

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { POST_STATUS_PILL } from "@/features/social/lib/post-display";
import type { SocialPostRow } from "@/features/social/lib/post-row";
import type React from "react";
import { FaXmark } from "react-icons/fa6";

/**
 * Composer heading row.
 * @param props - Component props.
 * @param props.row - The open post or preset.
 * @param props.headingRef - The heading, focused when another post opens.
 * @param props.isBusy - Whether a button's post is being created or loaded.
 * @param props.savingPreset - Whether Save as preset is running.
 * @param props.onCreate - Creates a post or preset from this one and opens it.
 * @param props.onSaveAsPreset - Copies this post into a new preset.
 * @param props.onDelete - Asks to delete this post or preset.
 * @param props.onClose - Closes the composer.
 * @returns Header element.
 */
export function SocialComposerHeader({
  row,
  headingRef,
  isBusy,
  savingPreset,
  onCreate,
  onSaveAsPreset,
  onDelete,
  onClose,
}: {
  row: SocialPostRow;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  isBusy: (key: string) => boolean;
  savingPreset: boolean;
  onCreate: (body: Record<string, unknown>, key: string) => void;
  onSaveAsPreset: () => void;
  onDelete: () => void;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-admin-border pb-3">
      <div className="flex min-w-0 items-center gap-2">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="truncate text-lg font-semibold text-admin-text focus:outline-none"
        >
          {row.name || "Untitled"}
        </h2>
        {row.isPreset ? (
          <StatusPill tone="neutral">Preset</StatusPill>
        ) : (
          <StatusPill tone={POST_STATUS_PILL[row.status].tone}>
            {POST_STATUS_PILL[row.status].label}
          </StatusPill>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {row.isPreset && (
          <AdminButton
            size="sm"
            busy={isBusy(`use-${row.id}`)}
            onClick={() => onCreate({ source: "copy", sourceId: row.id }, `use-${row.id}`)}
          >
            Write a post from this
          </AdminButton>
        )}
        {!row.isPreset && (
          <>
            <AdminButton
              size="sm"
              variant="secondary"
              busy={isBusy(`copy-${row.id}`)}
              onClick={() => onCreate({ source: "copy", sourceId: row.id }, `copy-${row.id}`)}
            >
              Duplicate
            </AdminButton>
            <AdminButton size="sm" variant="secondary" busy={savingPreset} onClick={onSaveAsPreset}>
              Save as preset
            </AdminButton>
          </>
        )}
        {row.status !== "posting" && row.status !== "removing" && (
          <AdminButton size="sm" variant="danger" onClick={onDelete}>
            Delete
          </AdminButton>
        )}
        <AdminButton size="sm" variant="ghost" onClick={onClose}>
          <FaXmark aria-hidden className="size-3.5" /> Close
        </AdminButton>
      </div>
    </div>
  );
}
