"use client";
// src/features/social/components/CaptionsField.tsx
// A content item's caption switcher: a chip per caption, then add, move and remove. The post
// box below edits whichever caption is picked.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { adminChipClass } from "@/features/admin/components/ui/chip-classes";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { MAX_CAPTIONS } from "@/features/social/lib/postings-core";
import { charCount } from "@/features/social/lib/validate";
import type React from "react";
import { useState } from "react";
import { FaArrowLeft, FaArrowRight, FaPlus, FaTrash } from "react-icons/fa6";

/**
 * Caption chips and their tools.
 * @param props - Component props.
 * @param props.captions - Every caption in order; caption 1 is the post's words.
 * @param props.active - The caption being edited.
 * @param props.next - The caption the next posting takes.
 * @param props.editable - Whether captions can change.
 * @param props.onSelect - Picks a caption to edit.
 * @param props.onAdd - Adds a blank caption at the end and picks it.
 * @param props.onMove - Moves the picked caption one place earlier (-1) or later (1).
 * @param props.onRemove - Removes the picked caption.
 * @returns The caption switcher.
 */
export function CaptionsField({
  captions,
  active,
  next,
  editable,
  onSelect,
  onAdd,
  onMove,
  onRemove,
}: {
  captions: string[];
  active: number;
  next: number;
  editable: boolean;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}): React.ReactElement {
  const [confirming, setConfirming] = useState(false);
  const many = captions.length > 1;

  /** Removes the picked caption, asking first when it has words. */
  function remove(): void {
    if (captions[active]?.trim()) setConfirming(true);
    else onRemove();
  }

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Captions" className="flex flex-wrap items-center gap-2">
        {captions.map((text, i) => {
          const blank = !text.trim();
          return (
            <button
              // Index keys: a caption is its place in the list, and moving one swaps the text.
              key={i}
              type="button"
              aria-pressed={i === active}
              onClick={() => onSelect(i)}
              className={adminChipClass(i === active)}
            >
              Caption {i + 1}
              <span className="ml-1.5 font-normal tabular-nums opacity-80">
                {blank ? "empty" : charCount(text).toLocaleString()}
              </span>
              {many && i === next && !blank && <span className="ml-1.5">- next</span>}
            </button>
          );
        })}
        {editable && (
          <AdminButton
            size="xs"
            variant="outline"
            disabled={captions.length >= MAX_CAPTIONS}
            title={
              captions.length >= MAX_CAPTIONS
                ? `A content item can have up to ${MAX_CAPTIONS} captions.`
                : undefined
            }
            onClick={onAdd}
          >
            <FaPlus aria-hidden /> Add caption
          </AdminButton>
        )}
      </div>
      {editable && many && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-admin-muted">Caption {active + 1}:</span>
          <AdminButton size="xs" variant="ghost" disabled={active === 0} onClick={() => onMove(-1)}>
            <FaArrowLeft aria-hidden /> Move earlier
          </AdminButton>
          <AdminButton
            size="xs"
            variant="ghost"
            disabled={active === captions.length - 1}
            onClick={() => onMove(1)}
          >
            Move later <FaArrowRight aria-hidden />
          </AdminButton>
          <AdminButton size="xs" variant="ghost" onClick={remove}>
            <FaTrash aria-hidden /> Remove
          </AdminButton>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title={`Remove caption ${active + 1}?`}
        body="Its words go. A posting already lined up with it takes another caption instead."
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => {
          setConfirming(false);
          onRemove();
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
