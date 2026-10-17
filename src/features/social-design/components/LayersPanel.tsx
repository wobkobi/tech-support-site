"use client";
// src/features/social-design/components/LayersPanel.tsx
// The post maker's layer list, top layer first as it stacks on the picture: drag to
// reorder, click to select (Shift adds), double-click to rename, and hide or lock each
// layer. Hiding applies to the size on screen only. With more than one size, a chain
// shows whether the layer still follows the other sizes here; a broken chain re-links.

import { IconButton } from "@/features/social-design/components/editor-fields";
import type { DesignDoc, Layer, LayerType } from "@/features/social-design/lib/doc";
import {
  moveLayerTo,
  relinkLayers,
  setHidden,
  updateLayers,
} from "@/features/social-design/lib/editor-ops";
import type { FormatKey } from "@/features/social-design/lib/formats";
import { cn } from "@/shared/lib/cn";
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
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type React from "react";
import { useCallback, useId, useState } from "react";
import type { IconType } from "react-icons";
import {
  FaAddressCard,
  FaCertificate,
  FaEye,
  FaEyeSlash,
  FaFont,
  FaGripVertical,
  FaIcons,
  FaImage,
  FaLink,
  FaLinkSlash,
  FaListCheck,
  FaLock,
  FaLockOpen,
  FaPanorama,
  FaQrcode,
  FaQuoteLeft,
  FaRegSquare,
  FaShapes,
  FaStar,
  FaTag,
} from "react-icons/fa6";

const TYPE_ICON: Record<LayerType, IconType> = {
  text: FaFont,
  image: FaImage,
  logo: FaCertificate,
  backdrop: FaPanorama,
  frosted: FaRegSquare,
  shape: FaShapes,
  bullets: FaListCheck,
  stars: FaStar,
  "quote-mark": FaQuoteLeft,
  qr: FaQrcode,
  icon: FaIcons,
  contact: FaAddressCard,
  promo: FaTag,
};

/**
 * Layers panel.
 * @param props - Component props.
 * @param props.doc - Design.
 * @param props.format - Size on screen.
 * @param props.selected - Selected layer ids.
 * @param props.apply - Runs an edit as an undo step.
 * @param props.onSelect - Picks layers; `additive` toggles them into the selection.
 * @returns Panel element.
 */
export function LayersPanel({
  doc,
  format,
  selected,
  apply,
  onSelect,
}: {
  doc: DesignDoc;
  format: FormatKey;
  selected: string[];
  apply: (edit: (doc: DesignDoc) => DesignDoc, tag?: string) => void;
  onSelect: (ids: string[], additive: boolean) => void;
}): React.ReactElement {
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Top of the stack first, as the layers sit on the picture.
  const shown = [...doc.layers].reverse();
  const manySizes = doc.formats.length > 1;

  /**
   * Drops a dragged row at its new place.
   * @param event - dnd-kit drag end.
   * @param event.active - Dragged row.
   * @param event.over - Row it was dropped on.
   */
  function onDragEnd({ active, over }: DragEndEvent): void {
    if (!over || active.id === over.id) return;
    const to = doc.layers.findIndex((l) => l.id === over.id);
    if (to === -1) return;
    apply((d) => moveLayerTo(d, String(active.id), to));
  }

  return (
    <div className="flex flex-col">
      <h2 className="px-3 pt-3 pb-2 text-sm font-semibold text-admin-text">Layers</h2>
      {shown.length === 0 ? (
        <p className="px-3 pb-3 text-sm text-admin-muted">Nothing here yet. Use Add to start.</p>
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={shown.map((l) => l.id)} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-0.5 px-1.5 pb-2">
              {shown.map((layer) => (
                <LayerRow
                  key={layer.id}
                  layer={layer}
                  hidden={!!doc.layouts[format]?.[layer.id]?.hidden}
                  linked={manySizes ? (doc.layouts[format]?.[layer.id]?.linked ?? true) : null}
                  selected={selected.includes(layer.id)}
                  onSelect={(additive) => onSelect([layer.id], additive)}
                  onRename={(name) => apply((d) => updateLayers(d, [layer.id], () => ({ name })))}
                  onToggleLock={() =>
                    apply((d) => updateLayers(d, [layer.id], (l) => ({ locked: !l.locked })))
                  }
                  onToggleHidden={() =>
                    apply((d) =>
                      setHidden(d, format, [layer.id], !d.layouts[format]?.[layer.id]?.hidden),
                    )
                  }
                  onRelink={() => apply((d) => relinkLayers(d, format, [layer.id]))}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

/**
 * One row in the layers list.
 * @param props - Component props.
 * @param props.layer - The layer.
 * @param props.hidden - Whether it is hidden on the size on screen.
 * @param props.linked - Whether it follows the other sizes here, or null with one size.
 * @param props.selected - Whether it is selected.
 * @param props.onSelect - Selects it; `additive` toggles it into the selection.
 * @param props.onRename - Renames it.
 * @param props.onToggleLock - Locks or unlocks it.
 * @param props.onToggleHidden - Hides or shows it on this size.
 * @param props.onRelink - Puts it back in step with the other sizes.
 * @returns Row element.
 */
function LayerRow({
  layer,
  hidden,
  linked,
  selected,
  onSelect,
  onRename,
  onToggleLock,
  onToggleHidden,
  onRelink,
}: {
  layer: Layer;
  hidden: boolean;
  linked: boolean | null;
  selected: boolean;
  onSelect: (additive: boolean) => void;
  onRename: (name: string) => void;
  onToggleLock: () => void;
  onToggleHidden: () => void;
  onRelink: () => void;
}): React.ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: layer.id });
  const [renaming, setRenaming] = useState(false);
  // Focus follows the double-click that opened the rename box. Stable, so a re-render
  // while typing doesn't select the text again.
  const selectOnMount = useCallback((el: HTMLInputElement | null) => el?.select(), []);
  const Icon = TYPE_ICON[layer.type];

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex items-center gap-1 rounded-md border pr-1",
        selected ? "border-moonstone-600 bg-moonstone-100" : "border-transparent hover:bg-admin-bg",
        isDragging && "z-10 shadow-md",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={`Drag to reorder ${layer.name}`}
        className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center text-admin-muted"
        {...attributes}
        {...listeners}
      >
        <FaGripVertical aria-hidden className="size-3" />
      </button>
      {renaming ? (
        <input
          ref={selectOnMount}
          aria-label="Layer name"
          defaultValue={layer.name}
          maxLength={120}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== layer.name) onRename(name);
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setRenaming(false);
          }}
          className="h-7 min-w-0 flex-1 rounded border border-admin-border-strong px-1.5 text-sm"
        />
      ) : (
        <button
          type="button"
          onClick={(e) => onSelect(e.shiftKey)}
          onDoubleClick={() => setRenaming(true)}
          title="Click to select, double-click to rename"
          className={cn(
            "flex h-8 min-w-0 flex-1 items-center gap-2 text-left text-sm",
            hidden ? "text-admin-muted" : "text-admin-text",
          )}
        >
          <Icon aria-hidden className="size-3.5 shrink-0 text-admin-text-secondary" />
          <span className="truncate">{layer.name}</span>
          {layer.groupId && (
            <span className="shrink-0 rounded bg-seasalt-200 px-1 text-sm text-admin-text-secondary">
              group
            </span>
          )}
        </button>
      )}
      {linked === true && (
        <span
          title="Follows the other sizes"
          className="flex size-7 shrink-0 items-center justify-center text-admin-muted"
        >
          <FaLink aria-hidden className="size-3" />
          <span className="sr-only">Follows the other sizes</span>
        </span>
      )}
      {linked === false && (
        <IconButton
          label={`${layer.name} is set by hand on this size. Re-link to follow the other sizes`}
          onClick={onRelink}
        >
          <FaLinkSlash aria-hidden className="size-3.5 text-coquelicot-700" />
        </IconButton>
      )}
      <IconButton
        label={hidden ? `Show ${layer.name} on this size` : `Hide ${layer.name} on this size`}
        onClick={onToggleHidden}
      >
        {hidden ? (
          <FaEyeSlash aria-hidden className="size-3.5" />
        ) : (
          <FaEye aria-hidden className="size-3.5" />
        )}
      </IconButton>
      <IconButton
        label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
        active={layer.locked}
        onClick={onToggleLock}
      >
        {layer.locked ? (
          <FaLock aria-hidden className="size-3.5" />
        ) : (
          <FaLockOpen aria-hidden className="size-3.5" />
        )}
      </IconButton>
    </li>
  );
}
