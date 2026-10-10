"use client";
// src/features/admin/components/QuickActionsSheet.tsx
// Bottom sheet opened by the phone bar's +: the QUICK_ACTIONS shortcuts as four large
// tiles. Also exports QuickActionTiles, the same tiles inline on the phone dashboard.

import { Modal } from "@/features/admin/components/ui/Modal";
import { QUICK_ACTIONS, quickActionHref } from "@/features/admin/lib/quick-actions";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";

/** Props for {@link QuickActionTiles}. */
interface QuickActionTilesProps {
  /** Value minted when the tiles were shown, so a repeat tap reopens a form. */
  stamp: string;
  /** Called after a tile is tapped (the sheet closes itself). */
  onPick?: () => void;
  /** "lg" for the sheet's two-by-two grid, "md" for the dashboard's single row. */
  size?: "md" | "lg";
  className?: string;
}

/**
 * The shortcut tiles: icon over label, each a large tap target.
 * @param props - Component props.
 * @param props.stamp - Stamp for form-opening links.
 * @param props.onPick - Called after a tile is tapped.
 * @param props.size - Tile size and grid.
 * @param props.className - Extra classes for the grid.
 * @returns The tile grid.
 */
export function QuickActionTiles({
  stamp,
  onPick,
  size = "md",
  className,
}: QuickActionTilesProps): React.ReactElement {
  const lg = size === "lg";
  return (
    <ul
      className={cn(
        "grid gap-2",
        lg ? "grid-cols-2" : "grid-cols-4 max-[22rem]:grid-cols-2",
        className,
      )}
    >
      {QUICK_ACTIONS.map((a) => (
        <li key={a.label}>
          <Link
            href={quickActionHref(a, stamp)}
            onClick={onPick}
            className={cn(
              "flex h-full flex-col items-center justify-center gap-1.5 rounded-lg border border-admin-border bg-admin-surface px-1.5 text-center leading-tight font-semibold text-admin-text transition-colors active:bg-admin-bg",
              lg ? "min-h-24 text-[0.9375rem]" : "min-h-21 text-sm",
            )}
          >
            <a.icon
              aria-hidden
              className={cn("text-russian-violet", lg ? "text-2xl" : "text-xl")}
            />
            {a.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Props for {@link QuickActionsSheet}. */
interface QuickActionsSheetProps {
  open: boolean;
  onClose: () => void;
  /** Value minted when the sheet opened. */
  stamp: string;
}

/**
 * The quick actions sheet.
 * @param props - Component props.
 * @param props.open - Whether the sheet is shown.
 * @param props.onClose - Closes the sheet.
 * @param props.stamp - Stamp minted when the sheet opened.
 * @returns The sheet, or null while closed.
 */
export function QuickActionsSheet({
  open,
  onClose,
  stamp,
}: QuickActionsSheetProps): React.ReactElement | null {
  return (
    <Modal open={open} onClose={onClose} title="Quick actions" size="sm" placement="sheet">
      <QuickActionTiles stamp={stamp} onPick={onClose} size="lg" />
    </Modal>
  );
}
