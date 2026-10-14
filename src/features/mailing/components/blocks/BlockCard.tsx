"use client";
// src/features/mailing/components/blocks/BlockCard.tsx
// One block in the editor: its name, the drag handle and move, copy and delete buttons,
// then that block type's controls. Alt+Up/Down while focus is inside moves it.

import type { InsertGroup } from "@/features/admin/components/ui/InsertMenu";
import {
  ButtonFields,
  HeadingFields,
  IconButton,
  ListFields,
  PictureFields,
  PromoFields,
  QuoteFields,
  STATIC_BLOCK_NOTES,
  TextFields,
} from "@/features/mailing/components/blocks/BlockFields";
import { BLOCK_LABELS, isEmptyBlock, type Block } from "@/features/mailing/lib/blocks";
import type { LinkTarget } from "@/features/mailing/lib/insertables";
import type { PromoWording } from "@/features/mailing/lib/render";
import { cn } from "@/shared/lib/cn";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type React from "react";
import { FaArrowDown, FaArrowUp, FaCopy, FaGripVertical, FaTrashCan } from "react-icons/fa6";

/** What every card shares, from the editor. */
export interface BlockCardShared {
  editable: boolean;
  canUpload: boolean;
  insertGroups: InsertGroup[];
  promo: PromoWording | null;
  linkTargets: LinkTarget[];
}

/** What an empty block's card says, so a blank card doesn't look broken. */
const EMPTY_HINTS: Partial<Record<Block["type"], string>> = {
  heading: "Empty, so it's left out of the email.",
  text: "Empty, so it's left out of the email.",
  list: "No points yet, so it's left out of the email.",
  button: "Needs words, so it's left out of the email.",
  picture: "No picture yet, so it's left out of the email.",
  quote: "No words yet, so it's left out of the email.",
};

/**
 * The block type's own controls.
 * @param props - Component props.
 * @param props.block - The block.
 * @param props.onChange - Reports a change.
 * @param props.shared - Editor-wide settings.
 * @returns The controls.
 */
function BlockBody({
  block,
  onChange,
  shared,
}: {
  block: Block;
  onChange: (patch: Partial<Block>, mergeKey?: string) => void;
  shared: BlockCardShared;
}): React.ReactElement {
  const { editable } = shared;
  switch (block.type) {
    case "heading":
      return <HeadingFields block={block} onChange={onChange} editable={editable} />;
    case "text":
      return (
        <TextFields
          block={block}
          onChange={onChange}
          editable={editable}
          insertGroups={shared.insertGroups}
          linkTargets={shared.linkTargets}
        />
      );
    case "list":
      return <ListFields block={block} onChange={onChange} editable={editable} />;
    case "button":
      return (
        <ButtonFields
          block={block}
          onChange={onChange}
          editable={editable}
          linkTargets={shared.linkTargets}
        />
      );
    case "picture":
      return (
        <PictureFields
          block={block}
          onChange={onChange}
          editable={editable}
          canUpload={shared.canUpload}
          linkTargets={shared.linkTargets}
        />
      );
    case "quote":
      return <QuoteFields block={block} onChange={onChange} editable={editable} />;
    case "promo":
      return <PromoFields promo={shared.promo} />;
    case "divider":
      return (
        <hr className="my-2 border-admin-border-strong" aria-label={STATIC_BLOCK_NOTES.divider} />
      );
    case "spacer":
      return <p className="text-sm text-admin-muted">{STATIC_BLOCK_NOTES.spacer}</p>;
    case "social":
      return <p className="text-center text-admin-text-secondary">{STATIC_BLOCK_NOTES.social}</p>;
  }
}

/**
 * A block's card.
 * @param props - Component props.
 * @param props.block - The block.
 * @param props.index - Its position, for the move buttons' labels and limits.
 * @param props.count - How many blocks there are.
 * @param props.shared - Editor-wide settings.
 * @param props.onChange - Reports a change to this block.
 * @param props.onMove - Moves it up (-1) or down (1).
 * @param props.onDuplicate - Copies it below itself.
 * @param props.onDelete - Removes it.
 * @returns The card.
 */
export function BlockCard({
  block,
  index,
  count,
  shared,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}: {
  block: Block;
  index: number;
  count: number;
  shared: BlockCardShared;
  onChange: (patch: Partial<Block>, mergeKey?: string) => void;
  onMove: (by: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const { editable } = shared;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id, disabled: !editable });
  const label = BLOCK_LABELS[block.type];
  const emptyHint = isEmptyBlock(block) ? EMPTY_HINTS[block.type] : undefined;

  return (
    <section
      ref={setNodeRef}
      data-block-id={block.id}
      tabIndex={-1}
      aria-label={`${label}, block ${index + 1} of ${count}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onKeyDown={(e) => {
        if (!editable || !e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          onMove(e.key === "ArrowUp" ? -1 : 1);
        }
      }}
      className={cn(
        "rounded-lg border border-admin-border bg-admin-surface outline-offset-2",
        isDragging && "relative z-10 shadow-lg",
      )}
    >
      <header className="flex items-center gap-1 border-b border-admin-border px-2 py-1">
        {editable && (
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag ${label} to move it`}
            title="Drag to move"
            className="hidden size-9 cursor-grab touch-none items-center justify-center rounded-md text-admin-muted hover:bg-admin-bg active:cursor-grabbing sm:inline-flex"
          >
            <FaGripVertical aria-hidden />
          </button>
        )}
        <h3 className="px-1 text-sm font-bold text-russian-violet">{label}</h3>
        {emptyHint && <span className="truncate text-sm text-admin-muted">{emptyHint}</span>}
        {editable && (
          <div className="ml-auto flex shrink-0 items-center">
            <IconButton
              label={`Move ${label} up`}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <FaArrowUp aria-hidden />
            </IconButton>
            <IconButton
              label={`Move ${label} down`}
              disabled={index === count - 1}
              onClick={() => onMove(1)}
            >
              <FaArrowDown aria-hidden />
            </IconButton>
            <IconButton label={`Copy ${label}`} onClick={onDuplicate}>
              <FaCopy aria-hidden />
            </IconButton>
            <IconButton label={`Delete ${label}`} onClick={onDelete}>
              <FaTrashCan aria-hidden />
            </IconButton>
          </div>
        )}
      </header>
      <div className="p-3">
        <BlockBody block={block} onChange={onChange} shared={shared} />
      </div>
    </section>
  );
}
