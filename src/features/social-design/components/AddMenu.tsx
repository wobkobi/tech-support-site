"use client";
// src/features/social-design/components/AddMenu.tsx
// The post maker's "Add" dropdown: every element the canvas can hold, grouped. Photos
// open the photo picker (recent photos or an upload); everything else goes straight
// onto the picture, centred.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import {
  LOGOS,
  TEXT_PRESET_KEYS,
  TEXT_PRESETS,
  type LogoVariant,
} from "@/features/social-design/lib/brand";
import type { AddKind } from "@/features/social-design/lib/new-layer";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { FaChevronDown, FaPlus } from "react-icons/fa6";

/** One entry in the menu. */
interface Item {
  label: string;
  hint?: string;
  /** What to add, or a photo pick for layers that need a file first. */
  add: AddKind | { kind: "pick-photo"; for: "image" | "backdrop" };
  disabled?: boolean;
}

/**
 * The menu's groups.
 * @param photosBusy - Whether a photo is uploading, so photo items wait.
 * @param bookingUrl - Booking page address, where a new QR code points.
 * @returns Groups in menu order.
 */
function groups(photosBusy: boolean, bookingUrl: string): { label: string; items: Item[] }[] {
  const wait = photosBusy ? "Waiting for the last photo to upload" : undefined;
  return [
    {
      label: "Words",
      items: TEXT_PRESET_KEYS.map((preset) => ({
        label: TEXT_PRESETS[preset].label,
        add: { kind: "text", preset },
      })),
    },
    {
      label: "Photos and logo",
      items: [
        {
          label: "Photo...",
          hint: wait ?? "A recent photo or a new upload",
          add: { kind: "pick-photo", for: "image" },
          disabled: photosBusy,
        },
        { label: "Empty photo frame", hint: "Pick the photo later", add: { kind: "photo-frame" } },
        ...(Object.keys(LOGOS) as LogoVariant[]).map((variant) => ({
          label: `Logo: ${LOGOS[variant].label.toLowerCase()}`,
          add: { kind: "logo", variant } as const,
        })),
      ],
    },
    {
      label: "Shapes and cards",
      items: [
        { label: "Frosted card", add: { kind: "frosted" } },
        { label: "Rectangle", add: { kind: "shape", shape: "rect" } },
        { label: "Circle", add: { kind: "shape", shape: "circle" } },
        { label: "Line", add: { kind: "shape", shape: "line" } },
        { label: "Arrow", add: { kind: "shape", shape: "arrow" } },
      ],
    },
    {
      label: "Elements",
      items: [
        { label: "Bullet list", hint: "Points with tick badges", add: { kind: "bullets" } },
        { label: "Stars", hint: "For reviews", add: { kind: "stars" } },
        { label: "Quote mark", add: { kind: "quote-mark" } },
        {
          label: "QR code",
          hint: "Opens the booking page",
          add: { kind: "qr", url: bookingUrl },
        },
        {
          label: "Icon",
          hint: "Pick which in the side panel",
          add: { kind: "icon", icon: "FaLaptop" },
        },
      ],
    },
    {
      label: "Live details",
      items: [
        {
          label: "Phone and email",
          hint: "From Settings",
          add: { kind: "contact", fields: ["phone", "email"] },
        },
        { label: "Website", hint: "From Settings", add: { kind: "contact", fields: ["website"] } },
        {
          label: "Promo offer",
          hint: "From the running promo",
          add: { kind: "promo", field: "offer" },
        },
        {
          label: "Promo end date",
          hint: "From the running promo",
          add: { kind: "promo", field: "ends" },
        },
        {
          label: "Promo summary",
          hint: "Deal and end date",
          add: { kind: "promo", field: "summary" },
        },
      ],
    },
    {
      label: "Backdrop",
      items: [
        { label: "Brand backdrop", add: { kind: "backdrop", source: "brand" } },
        { label: "Colour", add: { kind: "backdrop", source: "solid" } },
        {
          label: "Fade",
          hint: "Two colours, top to bottom",
          add: { kind: "backdrop", source: "gradient" },
        },
        {
          label: "Photo backdrop...",
          hint: wait,
          add: { kind: "pick-photo", for: "backdrop" },
          disabled: photosBusy,
        },
      ],
    },
  ];
}

/**
 * Add dropdown.
 * @param props - Component props.
 * @param props.photosBusy - Whether a photo is uploading, so photo items wait.
 * @param props.bookingUrl - Booking page address, where a new QR code points.
 * @param props.onAdd - Adds an element.
 * @param props.onPickPhoto - Opens the photo picker for a photo layer or photo backdrop.
 * @returns Menu element.
 */
export function AddMenu({
  photosBusy,
  bookingUrl,
  onAdd,
  onPickPhoto,
}: {
  photosBusy: boolean;
  bookingUrl: string;
  onAdd: (add: AddKind) => void;
  onPickPhoto: (target: "image" | "backdrop") => void;
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

  return (
    <div ref={rootRef} className="relative">
      <AdminButton aria-label="Add to the picture" onClick={() => setOpen((o) => !o)}>
        <FaPlus aria-hidden className="size-3" /> Add{" "}
        <FaChevronDown aria-hidden className="size-2.5" />
      </AdminButton>
      {open && (
        <div className="absolute top-full left-0 z-30 mt-1 grid max-h-[70vh] w-[min(36rem,calc(100vw-2rem))] gap-3 overflow-y-auto rounded-lg border border-admin-border bg-admin-surface p-3 shadow-lg sm:grid-cols-2">
          {groups(photosBusy, bookingUrl).map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-admin-text-secondary">{group.label}</p>
              {group.items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  disabled={item.disabled}
                  title={item.hint}
                  onClick={() => {
                    setOpen(false);
                    if (item.add.kind === "pick-photo") onPickPhoto(item.add.for);
                    else onAdd(item.add);
                  }}
                  className="flex flex-col items-start rounded-md px-2 py-1.5 text-left text-sm text-admin-text hover:bg-admin-bg disabled:opacity-40"
                >
                  {item.label}
                  {item.hint && <span className="text-admin-muted">{item.hint}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
