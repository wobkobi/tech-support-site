// src/features/admin/components/ui/AdminButton.tsx
// Compact back-office button. Same colours as the shared public Button (coquelicot
// primary, violet outline) at admin density: h-8/h-10 instead of the public h-12.
// Polymorphic: renders a Next.js Link when `href` is set, otherwise a native button. A
// `busy` button shows a spinner and is disabled. The variant and size classes come from
// adminButtonClass in button-classes.ts, which non-button elements can share.

"use client";

import {
  adminButtonClass,
  type AdminButtonSize,
  type AdminButtonVariant,
} from "@/features/admin/components/ui/button-classes";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";

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

  const base = cn(adminButtonClass({ variant, size }), className);

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
