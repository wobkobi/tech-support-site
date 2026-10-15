"use client";
// src/features/mailing/components/blocks/AddBlockMenu.tsx
// The "+ Add block" row between cards and at the end. It opens in place into a row of
// block types rather than a floating menu, so it never covers the card below on a phone.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { adminChipClass } from "@/features/admin/components/ui/chip-classes";
import { BLOCK_LABELS, type BlockType } from "@/features/mailing/lib/blocks";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useState } from "react";
import { FaPlus } from "react-icons/fa6";

const TYPES = Object.keys(BLOCK_LABELS) as BlockType[];

/**
 * Add-block row.
 * @param props - Component props.
 * @param props.onAdd - Adds a block of the picked type here.
 * @param props.prominent - The row at the end: a full button rather than a slim divider.
 * @returns The row.
 */
export function AddBlockMenu({
  onAdd,
  prominent = false,
}: {
  onAdd: (type: BlockType) => void;
  prominent?: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);

  if (!open) {
    return prominent ? (
      <div>
        <AdminButton variant="secondary" onClick={() => setOpen(true)}>
          <FaPlus aria-hidden /> Add block
        </AdminButton>
      </div>
    ) : (
      <div className="group flex items-center gap-2">
        <span aria-hidden className="h-px flex-1 bg-admin-border" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Add a block here"
          title="Add a block here"
          className="inline-flex size-7 items-center justify-center rounded-full border border-admin-border bg-admin-surface text-admin-muted hover:border-moonstone-600 hover:text-moonstone-700 pointer-coarse:size-10"
        >
          <FaPlus aria-hidden className="size-3" />
        </button>
        <span aria-hidden className="h-px flex-1 bg-admin-border" />
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Pick a block to add"
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-moonstone-600 bg-moonstone-50 p-2"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      {TYPES.map((type, i) => (
        <button
          key={type}
          type="button"
          // Focus the first choice on open, so the keyboard lands in the row.
          autoFocus={i === 0}
          onClick={() => {
            setOpen(false);
            onAdd(type);
          }}
          className={cn(adminChipClass(false), "bg-admin-surface")}
        >
          {BLOCK_LABELS[type]}
        </button>
      ))}
      <AdminButton size="xs" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </AdminButton>
    </div>
  );
}
