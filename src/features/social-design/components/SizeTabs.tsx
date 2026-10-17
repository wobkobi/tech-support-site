"use client";
// src/features/social-design/components/SizeTabs.tsx
// The post maker's size tabs: a live thumbnail of every size the design makes, a
// "Side by side" tab showing them all at once, and a "Sizes" menu to add or remove sizes, with the less
// common ones (covers, banners, profile picture) listed under "More sizes".

import { DesignPreview } from "@/features/social-design/components/canvas/DesignPreview";
import type { BoundValues, DesignDoc } from "@/features/social-design/lib/doc";
import { FORMAT_KEYS, FORMATS, type FormatKey } from "@/features/social-design/lib/formats";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { FaChevronDown, FaTableCellsLarge } from "react-icons/fa6";

// Thumbnail height in screen pixels.
const THUMB_H = 56;

/**
 * Size tabs.
 * @param props - Component props.
 * @param props.doc - Design (may lag a moment behind edits, to keep typing smooth).
 * @param props.format - Size on screen.
 * @param props.allSizes - Whether the all-sizes view is showing.
 * @param props.bound - Live values for contact and promo layers.
 * @param props.family - Exo's font-family list, or null while fonts load.
 * @param props.onPick - Shows one size.
 * @param props.onAllSizes - Shows every size side by side; leave it out for no Side by side tab.
 * @param props.onAdd - Adds a size to the design.
 * @param props.onRemove - Removes a size from the design.
 * @returns Tab row.
 */
export function SizeTabs({
  doc,
  format,
  allSizes,
  bound,
  family,
  onPick,
  onAllSizes,
  onAdd,
  onRemove,
}: {
  doc: DesignDoc;
  format: FormatKey;
  allSizes: boolean;
  bound: BoundValues;
  family: string | null;
  onPick: (format: FormatKey) => void;
  onAllSizes?: () => void;
  onAdd: (format: FormatKey) => void;
  onRemove: (format: FormatKey) => void;
}): React.ReactElement {
  return (
    <div className="flex items-stretch gap-2">
      <div
        role="tablist"
        aria-label="Sizes"
        className="flex min-w-0 flex-1 items-stretch gap-1.5 overflow-x-auto pb-1"
      >
        {doc.formats.map((f) => {
          const on = !allSizes && f === format;
          return (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={on}
              title={`${FORMATS[f].label}: ${FORMATS[f].width} × ${FORMATS[f].height}, for ${FORMATS[f].usedFor.toLowerCase()}`}
              onClick={() => onPick(f)}
              className={cn(
                "flex shrink-0 flex-col items-center gap-1 rounded-md border p-1.5 text-sm",
                on
                  ? "border-moonstone-600 bg-moonstone-100 text-admin-text"
                  : "border-admin-border bg-admin-surface text-admin-text-secondary hover:bg-admin-bg",
              )}
            >
              <span className="flex items-center justify-center" style={{ height: THUMB_H }}>
                {family ? (
                  <span className="overflow-hidden rounded-sm shadow-sm">
                    <DesignPreview
                      doc={doc}
                      format={f}
                      bound={bound}
                      family={family}
                      height={THUMB_H}
                    />
                  </span>
                ) : (
                  <span
                    className="rounded-sm bg-seasalt-200"
                    style={{
                      height: THUMB_H,
                      width: (THUMB_H * FORMATS[f].width) / FORMATS[f].height,
                    }}
                  />
                )}
              </span>
              <span className="whitespace-nowrap">{FORMATS[f].label}</span>
            </button>
          );
        })}
        {onAllSizes && doc.formats.length > 1 && (
          <button
            type="button"
            role="tab"
            aria-selected={allSizes}
            onClick={onAllSizes}
            title="Every size side by side, each one editable"
            className={cn(
              "flex shrink-0 flex-col items-center justify-end gap-1 rounded-md border p-1.5 text-sm",
              allSizes
                ? "border-moonstone-600 bg-moonstone-100 text-admin-text"
                : "border-admin-border bg-admin-surface text-admin-text-secondary hover:bg-admin-bg",
            )}
          >
            <span className="flex items-center" style={{ height: THUMB_H }}>
              <FaTableCellsLarge aria-hidden className="size-6" />
            </span>
            <span className="whitespace-nowrap">Side by side</span>
          </button>
        )}
      </div>
      <SizesMenu formats={doc.formats} onAdd={onAdd} onRemove={onRemove} />
    </div>
  );
}

/**
 * Dropdown to pick which sizes the design makes.
 * @param props - Component props.
 * @param props.formats - Sizes the design makes now.
 * @param props.onAdd - Adds a size.
 * @param props.onRemove - Removes a size.
 * @returns Menu element.
 */
function SizesMenu({
  formats,
  onAdd,
  onRemove,
}: {
  formats: FormatKey[];
  onAdd: (format: FormatKey) => void;
  onRemove: (format: FormatKey) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    /**
     * Closes when the press lands outside the menu.
     * @param e - Pointer event.
     */
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    /**
     * Closes on Escape.
     * @param e - Keyboard event.
     */
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups = [
    { label: "Main sizes", keys: FORMAT_KEYS.filter((k) => FORMATS[k].group === "core") },
    { label: "More sizes", keys: FORMAT_KEYS.filter((k) => FORMATS[k].group === "extra") },
  ];

  return (
    <div ref={rootRef} className="relative shrink-0 self-center">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-1.5 rounded-md border border-admin-border-strong bg-admin-surface px-3 text-sm text-admin-text hover:bg-admin-bg"
      >
        Sizes <FaChevronDown aria-hidden className="size-2.5" />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-1 flex max-h-[70vh] w-80 flex-col gap-3 overflow-y-auto rounded-lg border border-admin-border bg-admin-surface p-3 shadow-lg">
          {groups.map((group) => (
            <fieldset key={group.label} className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-semibold text-admin-text-secondary">
                {group.label}
              </legend>
              {group.keys.map((k) => {
                const on = formats.includes(k);
                const last = on && formats.length === 1;
                return (
                  <label
                    key={k}
                    title={last ? "A design needs at least one size" : undefined}
                    className={cn(
                      "flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-admin-bg",
                      last && "opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={last}
                      onChange={() => (on ? onRemove(k) : onAdd(k))}
                      className="mt-0.5 size-4 accent-moonstone-600"
                    />
                    <span className="flex flex-col">
                      <span className="text-admin-text">
                        {FORMATS[k].label}{" "}
                        <span className="text-admin-muted">
                          {FORMATS[k].width} × {FORMATS[k].height}
                        </span>
                      </span>
                      <span className="text-admin-muted">{FORMATS[k].usedFor}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ))}
          <p className="text-sm text-admin-muted">
            A new size is laid out from the closest shape you already have. Taking a size away can
            be undone.
          </p>
        </div>
      )}
    </div>
  );
}
