// src/features/admin/components/ui/button-classes.ts
// Class strings behind AdminButton, so a native anchor or a button that needs its own ref
// and ARIA can wear the exact AdminButton look. Kept out of the "use client" AdminButton
// module so server components can call it too.

import { cn } from "@/shared/lib/cn";

/** Visual variant. */
export type AdminButtonVariant = "primary" | "secondary" | "outline" | "danger" | "ghost";
/** Control height. */
export type AdminButtonSize = "xs" | "sm";

/**
 * Variant classes.
 * @param variant - Button variant.
 * @returns Class string.
 */
function variantClasses(variant: AdminButtonVariant): string {
  switch (variant) {
    case "primary":
      // Hover darkens: white on coquelicot-500 fails AA (~3.5:1) at this size.
      return "bg-coquelicot-600 text-white hover:bg-coquelicot-700";
    case "secondary":
      return "border border-admin-border-strong bg-admin-surface text-admin-text hover:border-russian-violet";
    case "outline":
      return "border-2 border-russian-violet bg-admin-surface text-russian-violet hover:bg-russian-violet hover:text-white";
    case "danger":
      // Outlined, so a destructive action never reads as the filled red primary.
      return "border-2 border-coquelicot-600 bg-admin-surface text-coquelicot-700 hover:bg-coquelicot-50";
    case "ghost":
      return "text-admin-text-secondary hover:bg-admin-bg";
  }
}

/**
 * Size classes (height, padding, text, icon gap).
 * @param size - Button size.
 * @returns Class string.
 */
function sizeClasses(size: AdminButtonSize): string {
  // A finger needs about 44px where a mouse is happy with 32-40px, so touch
  // screens grow the button without changing the desktop density. Both sizes
  // keep text at the 14px admin minimum or above.
  switch (size) {
    case "xs":
      return "h-8 gap-1.5 px-3 text-sm pointer-coarse:min-h-11";
    case "sm":
      return "h-10 gap-2 px-4 text-[0.9375rem] pointer-coarse:min-h-11";
  }
}

/**
 * The full AdminButton class string for a variant and size, before any caller className.
 * @param options - Look to build.
 * @param options.variant - Button variant; defaults to primary, as on AdminButton.
 * @param options.size - Button size; defaults to sm, as on AdminButton.
 * @returns Class string.
 */
export function adminButtonClass({
  variant = "primary",
  size = "sm",
}: {
  variant?: AdminButtonVariant;
  size?: AdminButtonSize;
} = {}): string {
  return cn(
    // select-none keeps link-rendered buttons unselectable like native ones.
    "inline-flex items-center justify-center rounded-md font-semibold whitespace-nowrap transition-colors select-none",
    variantClasses(variant),
    sizeClasses(size),
  );
}
