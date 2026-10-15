"use client";
// src/features/mailing/components/blocks/BlockEditor.tsx
// The email body as a stack of blocks. The body text stays the saved form: it's parsed
// into blocks on open and written back only after a real block edit, so opening an email
// or switching tabs never rewrites it (template matching compares body strings).

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ADMIN_LINK_CLS } from "@/features/admin/components/ui/field-classes";
import type { InsertGroup } from "@/features/admin/components/ui/InsertMenu";
import { useToast } from "@/features/admin/components/ui/Toast";
import { AddBlockMenu } from "@/features/mailing/components/blocks/AddBlockMenu";
import { BlockCard, type BlockCardShared } from "@/features/mailing/components/blocks/BlockCard";
import { DraftDialog } from "@/features/mailing/components/blocks/DraftDialog";
import { useBlockHistory } from "@/features/mailing/components/blocks/useBlockHistory";
import { fillBlocks } from "@/features/mailing/lib/ai-draft";
import {
  emptyBlock,
  newBlockId,
  parseBlocks,
  serializeBlocks,
  type Block,
  type BlockType,
} from "@/features/mailing/lib/blocks";
import type { LinkTarget } from "@/features/mailing/lib/insertables";
import type { PromoWording } from "@/features/mailing/lib/render";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import Link from "next/link";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { FaArrowRotateLeft, FaArrowRotateRight, FaWandMagicSparkles } from "react-icons/fa6";

/** Where focus goes after a change: the card itself (a move) or its first field (an add). */
interface FocusTarget {
  id: string;
  field: boolean;
  /** Bumped every time, so focusing the same block twice still runs the effect. */
  n: number;
}

/**
 * Block editor.
 * @param props - Component props.
 * @param props.body - The saved body text.
 * @param props.onChange - Called with the new body text after an edit.
 * @param props.editable - False for sent or sending emails: blocks show without controls.
 * @param props.canUpload - Whether picture uploads are set up.
 * @param props.insertGroups - The Add menu for Text blocks.
 * @param props.promo - Today's promo wording, for the promo card.
 * @param props.linkTargets - Pages buttons and pictures can link to.
 * @param props.draft - Turns on "Draft with AI": the email's linked promo, and where the
 *   drafted subject and preview text go. Null when OpenAI isn't set up.
 * @returns The editor.
 */
export function BlockEditor({
  body,
  onChange,
  editable,
  canUpload,
  insertGroups,
  promo,
  linkTargets,
  draft = null,
}: {
  body: string;
  onChange: (body: string) => void;
  editable: boolean;
  canUpload: boolean;
  insertGroups: InsertGroup[];
  promo: PromoWording | null;
  linkTargets: LinkTarget[];
  draft?: {
    promoId: string | null;
    onSubject: (subject: string, preheader: string) => void;
  } | null;
}): React.ReactElement {
  const { toast } = useToast();
  const [drafting, setDrafting] = useState(false);
  const { blocks, commit, undo, redo, reset, canUndo, canRedo } = useBlockHistory(() =>
    parseBlocks(body),
  );
  // The body this editor last wrote (or was opened with). A different body arriving means
  // it changed outside (template switch, the plain text tab), so re-parse and start a
  // fresh history.
  const [emitted, setEmitted] = useState(body);
  if (body !== emitted) {
    setEmitted(body);
    reset(parseBlocks(body, `${newBlockId()}-`));
  }

  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Buttons are blocks of their own here, so the Text block's Add menu leaves them out.
  const textInsertGroups = useMemo(
    () =>
      insertGroups
        .map((g) => ({ ...g, items: g.items.filter((item) => !item.line) }))
        .filter((g) => g.items.length > 0),
    [insertGroups],
  );
  const shared: BlockCardShared = {
    editable,
    canUpload,
    insertGroups: textInsertGroups,
    promo,
    linkTargets,
  };

  useEffect(() => {
    if (!focus) return;
    const card = rootRef.current?.querySelector<HTMLElement>(
      `[data-block-id="${CSS.escape(focus.id)}"]`,
    );
    if (!card) return;
    const field = focus.field
      ? card.querySelector<HTMLElement>(
          ".p-3 :is(input:not([type=hidden]), textarea, select, button):not(:disabled)",
        )
      : null;
    (field ?? card).focus();
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);

  /**
   * Writes the body for a new block list, if the text it gives actually changed (an
   * empty block added or removed leaves the body as it was).
   * @param next - The blocks.
   */
  function emit(next: Block[]): void {
    const text = serializeBlocks(next);
    if (text === emitted) return;
    setEmitted(text);
    onChange(text);
  }

  /**
   * Records an edit and writes it back.
   * @param next - The new blocks.
   * @param mergeKey - Field being typed in, so a run of keystrokes is one undo step.
   */
  function apply(next: Block[], mergeKey?: string): void {
    commit(next, mergeKey);
    emit(next);
  }

  /**
   * Moves focus once React has drawn the change.
   * @param id - Block to focus.
   * @param field - Focus its first field rather than the card.
   */
  function focusBlock(id: string, field: boolean): void {
    setFocus((prev) => ({ id, field, n: (prev?.n ?? 0) + 1 }));
  }

  /**
   * Adds a new block.
   * @param type - Which kind.
   * @param at - Index it goes in at.
   */
  function add(type: BlockType, at: number): void {
    const block = emptyBlock(type);
    apply([...blocks.slice(0, at), block, ...blocks.slice(at)]);
    focusBlock(block.id, true);
  }

  /**
   * Moves a block one place.
   * @param index - Its position.
   * @param by - -1 up, 1 down.
   */
  function move(index: number, by: -1 | 1): void {
    const to = index + by;
    if (to < 0 || to >= blocks.length) return;
    apply(arrayMove(blocks, index, to));
    focusBlock(blocks[index]!.id, false);
  }

  /**
   * Copies a block in below itself.
   * @param index - Its position.
   */
  function duplicate(index: number): void {
    const copy = { ...structuredClone(blocks[index]!), id: newBlockId() };
    apply([...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)]);
    focusBlock(copy.id, false);
  }

  /**
   * Deletes a block (no confirm: Undo brings it back), then focuses its neighbour.
   * @param index - Its position.
   */
  function remove(index: number): void {
    const next = blocks.filter((_, i) => i !== index);
    apply(next);
    const neighbour = next[Math.min(index, next.length - 1)];
    if (neighbour) focusBlock(neighbour.id, false);
  }

  /**
   * Merges a field change into one block.
   * @param index - Its position.
   * @param patch - The fields that changed.
   * @param mergeKey - Field being typed in.
   */
  function change(index: number, patch: Partial<Block>, mergeKey?: string): void {
    const next = blocks.map((b, i) => (i === index ? ({ ...b, ...patch } as Block) : b));
    apply(next, mergeKey);
  }

  /**
   * Reorders after a drag.
   * @param event - The drag result.
   * @param event.active - The dragged block.
   * @param event.over - The block it was dropped on, or null outside the list.
   */
  function onDragEnd({ active, over }: DragEndEvent): void {
    if (!over || active.id === over.id) return;
    const from = blocks.findIndex((b) => b.id === active.id);
    const to = blocks.findIndex((b) => b.id === over.id);
    if (from < 0 || to < 0) return;
    apply(arrayMove(blocks, from, to));
  }

  /**
   * Steps undo or redo and writes the result back.
   * @param step - {@link undo} or {@link redo}.
   */
  function travel(step: () => Block[] | null): void {
    const target = step();
    if (target) emit(target);
  }

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        if (!editable || !(e.ctrlKey || e.metaKey) || e.altKey) return;
        const key = e.key.toLowerCase();
        if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          travel(undo);
        } else if (key === "y" || (key === "z" && e.shiftKey)) {
          e.preventDefault();
          travel(redo);
        }
      }}
    >
      {editable && (
        <div className="flex flex-wrap items-center gap-1.5">
          <AdminButton
            size="xs"
            variant="secondary"
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            onClick={() => travel(undo)}
          >
            <FaArrowRotateLeft aria-hidden /> Undo
          </AdminButton>
          <AdminButton
            size="xs"
            variant="secondary"
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            onClick={() => travel(redo)}
          >
            <FaArrowRotateRight aria-hidden /> Redo
          </AdminButton>
          {draft && (
            <AdminButton size="xs" variant="secondary" onClick={() => setDrafting(true)}>
              <FaWandMagicSparkles aria-hidden /> Draft with AI
            </AdminButton>
          )}
          <p className="ml-auto hidden text-sm text-admin-muted sm:block">
            Alt+Up or Alt+Down moves the block you&apos;re in.
          </p>
        </div>
      )}

      {draft && drafting && (
        <DraftDialog
          promoId={draft.promoId}
          buttonUrl={blocks.find((b) => b.type === "button")?.url ?? ""}
          onClose={() => setDrafting(false)}
          onDraft={(result, withSubject) => {
            setDrafting(false);
            apply(fillBlocks(blocks, result));
            if (withSubject) draft.onSubject(result.subject, result.preheader);
            toast("Draft added. Read it through and make it yours; Undo takes it back.", {
              tone: "success",
            });
          }}
        />
      )}

      {blocks.length === 0 && (
        <p className="rounded-lg border border-dashed border-admin-border p-4 text-center text-admin-muted">
          {editable ? "Nothing in this email yet. Add a block to start." : "This email is empty."}
        </p>
      )}

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          {blocks.map((block, i) => (
            <React.Fragment key={block.id}>
              {editable && i > 0 && <AddBlockMenu onAdd={(type) => add(type, i)} />}
              <BlockCard
                block={block}
                index={i}
                count={blocks.length}
                shared={shared}
                onChange={(patch, mergeKey) => change(i, patch, mergeKey)}
                onMove={(by) => move(i, by)}
                onDuplicate={() => duplicate(i)}
                onDelete={() => remove(i)}
              />
            </React.Fragment>
          ))}
        </SortableContext>
      </DndContext>

      {editable && <AddBlockMenu prominent onAdd={(type) => add(type, blocks.length)} />}

      <div className="rounded-lg border border-admin-border bg-admin-bg px-3 py-2 text-sm text-admin-muted">
        Your sign-off and the unsubscribe line are added under this from{" "}
        <Link href="/admin/settings?tab=identity" className={`${ADMIN_LINK_CLS} whitespace-nowrap`}>
          Settings &gt; Identity
        </Link>
        .
      </div>
    </div>
  );
}
