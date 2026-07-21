// src/features/admin/components/ui/AdminButton.tsx
/**
 * @description Compact back-office button. Cloned (not extended) from the shared
 * public Button - the public primary is coquelicot h-12 for the marketing site,
 * whereas admin wants russian-violet h-8/h-9 controls. Polymorphic: renders a
 * Next.js Link when `href` is set, otherwise a native button. A `busy` button
 * shows a spinner and is disabled.
 */

"use client";

import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";

/** Visual variant. */
type AdminButtonVariant = "primary" | "secondary" | "danger" | "ghost";
/** Control height. */
type AdminButtonSize = "xs" | "sm";

/** Props shared by both the link and button forms. */
interface AdminButtonCommon {
  variant?: AdminButtonVariant;
  size?: AdminButtonSize;
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
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
}

export type AdminButtonProps = AdminButtonAsLink | AdminButtonAsButton;

/**
 * Variant classes.
 * @param variant - Button variant.
 * @returns Class string.
 */
function variantClasses(variant: AdminButtonVariant): string {
  switch (variant) {
    case "primary":
      return "bg-russian-violet text-white hover:bg-russian-violet-600";
    case "secondary":
      return "border border-admin-border-strong bg-admin-surface text-admin-text hover:bg-admin-bg";
    case "danger":
      return "bg-coquelicot-400 text-white hover:bg-coquelicot-500";
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
  switch (size) {
    case "xs":
      return "h-8 gap-1.5 px-3 text-xs";
    case "sm":
      return "h-9 gap-2 px-4 text-sm";
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
    "inline-flex items-center justify-center rounded-lg font-semibold whitespace-nowrap",
    "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-russian-violet",
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

  const { type = "button", onClick, disabled = false, busy = false } = props as AdminButtonAsButton;
  const isDisabled = disabled || busy;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      aria-busy={busy}
      aria-label={ariaLabel}
      className={cn(base, isDisabled && "cursor-not-allowed opacity-60")}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}
