"use client";
// src/features/social/components/ScheduleItems.tsx
// The content a schedule takes turns through: a list you can drag into order, with a warning on
// any item it can't post, and a picker to add more from the library.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Modal } from "@/features/admin/components/ui/Modal";
import type { ContentListRow } from "@/features/social/lib/content-row";
import { foldText } from "@/features/social/lib/library";
import { SOCIAL_CONTENT_PATH } from "@/features/social/lib/links";
import { captionsOf } from "@/features/social/lib/postings-core";
import { MAX_QUEUE_ITEMS } from "@/features/social/lib/queue-slots";
import { itemHold } from "@/features/social/lib/queues";
import type { SocialPlatformKey } from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import type React from "react";
import { useId, useMemo, useState } from "react";
import { FaGripVertical, FaPlus, FaTriangleExclamation, FaXmark } from "react-icons/fa6";

/**
 * A line on an item's captions and postings so far.
 * @param row - The item.
 * @returns Plain words.
 */
function itemLine(row: ContentListRow): string {
  const captions = captionsOf(row.item).length;
  const parts = [captions === 1 ? "1 caption" : `${captions} captions`];
  const { count, lastPostedAt } = row.stats;
  if (count === 0) parts.push("no postings yet");
  else {
    parts.push(
      `${count === 1 ? "1 posting" : `${count} postings`}${
        lastPostedAt ? `, last ${formatDateShort(lastPostedAt)}` : ""
      }`,
    );
  }
  return parts.join(", ");
}

/**
 * Why the schedule won't post an item.
 * @param row - The item.
 * @param platforms - The schedule's apps.
 * @returns The reason, or null.
 */
function holdOf(row: ContentListRow, platforms: readonly SocialPlatformKey[]): string | null {
  return itemHold(
    {
      spent: row.spent,
      recycle: row.item.recycle,
      posted: row.stats.count,
      platforms: row.item.targets.filter((t) => t.enabled).map((t) => t.platform),
    },
    platforms,
  );
}

/**
 * Schedule content list.
 * @param props - Component props.
 * @param props.itemIds - The schedule's items in order.
 * @param props.onChange - Called with the new order.
 * @param props.content - Every content item.
 * @param props.platforms - The schedule's apps, to warn about items not on them.
 * @param props.numbered - Show positions, for In the order below.
 * @param props.disabled - Greys the list out while saving.
 * @returns List element.
 */
export function ScheduleItems({
  itemIds,
  onChange,
  content,
  platforms,
  numbered,
  disabled,
}: {
  itemIds: string[];
  onChange: (itemIds: string[]) => void;
  content: ContentListRow[];
  platforms: readonly SocialPlatformKey[];
  numbered: boolean;
  disabled?: boolean;
}): React.ReactElement {
  const dndId = useId();
  const [adding, setAdding] = useState(false);
  const byId = useMemo(() => new Map(content.map((r) => [r.item.id, r])), [content]);
  // An item deleted since the page loaded drops out; the server drops it on save too.
  const rows = itemIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * Drops a dragged row at its new place.
   * @param event - dnd-kit drag end.
   * @param event.active - Dragged row.
   * @param event.over - Row it was dropped on.
   */
  function onDragEnd({ active, over }: DragEndEvent): void {
    if (!over || active.id === over.id) return;
    const ids = rows.map((r) => r.item.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onChange(arrayMove(ids, from, to));
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-admin-border-strong p-4 text-admin-muted">
          No content in this schedule yet. Add the items it should take turns through.
        </p>
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={rows.map((r) => r.item.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol className="flex flex-col gap-1.5">
              {rows.map((row, i) => (
                <ItemRow
                  key={row.item.id}
                  row={row}
                  position={numbered ? i + 1 : null}
                  hold={holdOf(row, platforms)}
                  disabled={disabled}
                  onRemove={() => onChange(itemIds.filter((id) => id !== row.item.id))}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <AdminButton
          size="sm"
          variant="secondary"
          disabled={disabled || itemIds.length >= MAX_QUEUE_ITEMS}
          onClick={() => setAdding(true)}
        >
          <FaPlus aria-hidden /> Add content
        </AdminButton>
        {rows.length > 1 && (
          <span className="text-sm text-admin-muted">Drag the handles to change the order.</span>
        )}
      </div>
      <AddContentDialog
        open={adding}
        content={content.filter((r) => !itemIds.includes(r.item.id))}
        room={MAX_QUEUE_ITEMS - itemIds.length}
        platforms={platforms}
        onAdd={(ids) => {
          onChange([...itemIds, ...ids]);
          setAdding(false);
        }}
        onClose={() => setAdding(false)}
      />
    </div>
  );
}

/**
 * One item in the schedule.
 * @param props - Component props.
 * @param props.row - The item.
 * @param props.position - Its place in the order, or null when unnumbered.
 * @param props.hold - Why the schedule won't post it, or null.
 * @param props.disabled - Greys the row out.
 * @param props.onRemove - Takes it out of the schedule.
 * @returns List item.
 */
function ItemRow({
  row,
  position,
  hold,
  disabled,
  onRemove,
}: {
  row: ContentListRow;
  position: number | null;
  hold: string | null;
  disabled?: boolean;
  onRemove: () => void;
}): React.ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.item.id, disabled });
  const name = row.item.name || "Untitled";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex items-start gap-2 rounded-lg border border-admin-border bg-admin-surface py-2 pr-1.5 pl-1",
        isDragging && "z-10 shadow-md",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={`Drag to reorder ${name}`}
        className="flex h-9 w-7 shrink-0 cursor-grab items-center justify-center text-admin-muted"
        {...attributes}
        {...listeners}
      >
        <FaGripVertical aria-hidden />
      </button>
      {position !== null && (
        <span className="mt-1.5 w-6 shrink-0 text-right font-semibold text-admin-muted tabular-nums">
          {position}.
        </span>
      )}
      <div className="min-w-0 flex-1 py-1">
        <Link
          href={`${SOCIAL_CONTENT_PATH}/${row.item.id}`}
          className="font-semibold wrap-break-word text-admin-text hover:underline"
        >
          {name}
        </Link>
        <p className="text-sm text-admin-muted">{itemLine(row)}</p>
        {hold && (
          <p className="mt-1 flex items-start gap-1.5 text-sm text-coquelicot-700">
            <FaTriangleExclamation aria-hidden className="mt-0.5 shrink-0" />
            {hold}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label={`Take ${name} out of the schedule`}
        disabled={disabled}
        onClick={onRemove}
        className="grid size-9 shrink-0 place-items-center rounded-md text-admin-muted hover:bg-admin-bg hover:text-admin-text disabled:opacity-50"
      >
        <FaXmark aria-hidden />
      </button>
    </li>
  );
}

/**
 * Picker for content to add to the schedule.
 * @param props - Component props.
 * @param props.open - Whether it's shown.
 * @param props.content - Items not in the schedule yet.
 * @param props.room - How many more the schedule can hold.
 * @param props.platforms - The schedule's apps, to warn about items not on them.
 * @param props.onAdd - Called with the ticked items' ids.
 * @param props.onClose - Closes it.
 * @returns Dialog element.
 */
function AddContentDialog({
  open,
  content,
  room,
  platforms,
  onAdd,
  onClose,
}: {
  open: boolean;
  content: ContentListRow[];
  room: number;
  platforms: readonly SocialPlatformKey[];
  onAdd: (ids: string[]) => void;
  onClose: () => void;
}): React.ReactElement {
  const [search, setSearch] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const words = foldText(search).split(/\s+/).filter(Boolean);
  const shown = content
    .filter((r) => {
      const hay = foldText([r.item.name, ...captionsOf(r.item)].join(" "));
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => a.item.name.localeCompare(b.item.name));
  const over = ticked.length > room;

  /** Closes and forgets the search and ticks. */
  function close(): void {
    setSearch("");
    setTicked([]);
    onClose();
  }

  /**
   * Ticks or unticks one item.
   * @param id - The item.
   * @param on - Ticked or not.
   */
  function tick(id: string, on: boolean): void {
    setTicked((prev) => (on ? [...prev, id] : prev.filter((t) => t !== id)));
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add content"
      description="Tick the items this schedule should take turns through."
      size="lg"
      footer={
        <>
          <AdminButton variant="secondary" onClick={close}>
            Cancel
          </AdminButton>
          <AdminButton
            disabled={ticked.length === 0 || over}
            onClick={() => {
              onAdd(ticked);
              setSearch("");
              setTicked([]);
            }}
          >
            {ticked.length <= 1 ? "Add" : `Add ${ticked.length}`}
          </AdminButton>
        </>
      }
    >
      {content.length === 0 ? (
        <p className="text-admin-muted">
          Every content item is in this schedule already. Make more in{" "}
          <Link href={SOCIAL_CONTENT_PATH} className="font-semibold underline underline-offset-2">
            Content
          </Link>
          .
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <AdminInput
              type="search"
              aria-label="Search content"
              placeholder="Search names and captions"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 min-w-0 flex-1"
            />
            <AdminButton
              size="sm"
              variant="ghost"
              onClick={() =>
                setTicked((prev) => [
                  ...prev,
                  ...shown.map((r) => r.item.id).filter((id) => !prev.includes(id)),
                ])
              }
            >
              Tick all shown
            </AdminButton>
          </div>
          {over && (
            <p className="text-sm text-coquelicot-700">
              A schedule holds {MAX_QUEUE_ITEMS} items at most, so there&apos;s room for {room}{" "}
              more.
            </p>
          )}
          <ul className="flex max-h-[50vh] flex-col divide-y divide-admin-border overflow-y-auto rounded-lg border border-admin-border">
            {shown.length === 0 && <li className="p-3 text-admin-muted">Nothing matches.</li>}
            {shown.map((r) => {
              const hold = holdOf(r, platforms);
              return (
                <li key={r.item.id}>
                  <label className="flex cursor-pointer items-start gap-3 p-3 hover:bg-admin-bg">
                    <input
                      type="checkbox"
                      checked={ticked.includes(r.item.id)}
                      onChange={(e) => tick(r.item.id, e.target.checked)}
                      className="mt-1 size-4 shrink-0 accent-russian-violet"
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold wrap-break-word text-admin-text">
                        {r.item.name || "Untitled"}
                      </span>
                      <span className="block text-sm text-admin-muted">{itemLine(r)}</span>
                      {hold && <span className="block text-sm text-coquelicot-700">{hold}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}
