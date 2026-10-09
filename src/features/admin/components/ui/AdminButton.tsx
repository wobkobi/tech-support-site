// src/features/admin/components/ui/AdminButton.tsx
// Compact back-office button. Same colours as the shared public Button (coquelicot
// primary, violet outline) at admin density: h-8/h-10 instead of the public h-12.
// Polymorphic: renders a Next.js Link when `href` is set, otherwise a native button. A
// `busy` button shows a spinner and is disabled.

"use client";

import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";

/** Visual variant. */
type AdminButtonVariant = "primary" | "secondary" | "outline" | "danger" | "ghost";
/** Control height. */
type AdminButtonSize = "xs" | "sm";

/** Props shared by both the link and button forms. */
interface AdminButtonCommon {
  variant?: AdminButtonVariant;
  size?: AdminButtonSize;
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
  "aria-current"?: "true" | "page";
}

/** Props when rendering as a link (href present). */
interface AdminButtonAsLink extends AdminButtonCommon {
  href: string;
  prefetch?: boolean;
}

/** Props when rendering as a native button (no href). */
interface AdminButtonAsButton extends AdminButtonCommon {
  href?: never;
  type?: "button" | "submit" | "reset";
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  /** Shows a spinner and disables the button while an action is in flight. */
  busy?: boolean;
  /** Native tooltip. */
  title?: string;
  /** Passed to the native button, for a label or disabled state that can differ at hydration. */
  suppressHydrationWarning?: boolean;
}

type AdminButtonProps = AdminButtonAsLink | AdminButtonAsButton;

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
  // screens grow the button without changing the desktop density.
  switch (size) {
    case "xs":
      return "h-8 gap-1.5 px-3 text-xs pointer-coarse:min-h-11";
    case "sm":
      return "h-10 gap-2 px-4 text-[0.9375rem] pointer-coarse:min-h-11";
  }
}

/**
 * Spinning indicator shown on a busy button.
 * @returns The spinner element.
 */
function Spinner(): React.ReactElement {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

/**
 * Compact admin button, rendered as a link or a native button depending on
 * whether `href` is present.
 * @param props - Component props (see {@link AdminButtonProps}).
 * @returns The button or link element.
 */
export function AdminButton(props: AdminButtonProps): React.ReactElement {
  const { variant = "primary", size = "sm", className, children } = props;
  const ariaLabel = props["aria-label"];

  const base = cn(
    // select-none keeps link-rendered buttons unselectable like native ones.
    "inline-flex items-center justify-center rounded-md font-bold whitespace-nowrap transition-colors select-none",
    variantClasses(variant),
    sizeClasses(size),
    className,
  );

  if ("href" in props && props.href) {
    return (
      <Link href={props.href} prefetch={props.prefetch} className={base} aria-label={ariaLabel}>
        {children}
      </Link>
    );
  }

  const {
    type = "button",
    onClick,
    disabled = false,
    busy = false,
    title,
    suppressHydrationWarning,
  } = props as AdminButtonAsButton;
  const isDisabled = disabled || busy;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      title={title}
      suppressHydrationWarning={suppressHydrationWarning}
      aria-busy={busy}
      aria-label={ariaLabel}
      aria-current={props["aria-current"]}
      className={cn(base, isDisabled && "cursor-not-allowed opacity-60")}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}
