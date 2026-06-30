// src/shared/components/Button.tsx
/**
 * @description Polymorphic button component with consistent variants and sizes.
 */

"use client";

import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

/**
 * Button props when rendering as a Next.js Link (href present).
 */
interface ButtonAsLink {
  href: string;
  prefetch?: boolean;
  scroll?: boolean;
  replace?: boolean;
  /**
   * When set, renders as a plain <a> with the download attribute instead of a Next.js Link.
   * Use for file downloads so the browser handles them directly without the router.
   */
  download?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /**
   * Visual styling only - Link will still navigate when clicked.
   * For truly disabled links, use conditional rendering instead.
   */
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  "aria-current"?: "page" | "step" | "location" | "date" | "time" | "true" | "false";
  "aria-label"?: string;
}

/**
 * Button props when rendering as a native button element (no href).
 */
interface ButtonAsButton {
  href?: never;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
  "aria-disabled"?: boolean;
  "aria-busy"?: boolean;
}

export type ButtonProps = ButtonAsLink | ButtonAsButton;

/**
 * Tailwind classes for the given variant.
 * @param variant - Button variant.
 * @returns Class string.
 */
function getVariantClasses(variant: ButtonVariant): string {
  switch (variant) {
    case "primary":
      // coquelicot-400 on seasalt clears WCAG AA (4.5:1) for the 16px label;
      // coquelicot-500 fails at ~3.5:1. Hover lightens one step, as before.
      return cn("bg-coquelicot-400 text-seasalt", "hover:bg-coquelicot-500", "transition-colors");
    case "secondary":
      return cn(
        "bg-russian-violet text-seasalt",
        "hover:bg-russian-violet-600",
        "transition-colors",
      );
    case "tertiary":
      return cn(
        "bg-moonstone-600 text-russian-violet",
        "hover:bg-moonstone-700",
        "shadow-md hover:shadow-lg",
        "transition-all",
      );
    case "ghost":
      return cn(
        "bg-transparent text-russian-violet",
        "border border-russian-violet/40",
        "hover:bg-russian-violet/10 hover:border-russian-violet/70",
        "transition-all",
      );
  }
}

/**
 * Tailwind classes for the given size.
 * @param size - Button size.
 * @returns Class string.
 */
function getSizeClasses(size: ButtonSize): string {
  switch (size) {
    case "sm":
      return "h-9 px-4 text-sm";
    case "md":
      return "h-12 px-5 text-base";
    case "lg":
      return "h-14 px-6 text-lg";
  }
}

/**
 * Polymorphic Button component
 *
 * Renders as Next.js Link when `href` is provided, otherwise as a native button.
 * Supports 4 variants (primary, secondary, tertiary, ghost) and 3 sizes (sm, md, lg).
 * @param props - Button props (discriminated by presence of href)
 * @returns Button or Link element
 */
export function Button(props: ButtonProps): React.ReactElement {
  const {
    variant = "primary",
    size = "md",
    fullWidth = false,
    disabled = false,
    className,
    children,
    ...rest
  } = props;

  const baseClasses = cn(
    "inline-flex items-center justify-center gap-2",
    "rounded-lg font-bold",
    "whitespace-nowrap",
    fullWidth && "w-full",
    getVariantClasses(variant),
    getSizeClasses(size),
    // Disabled appearance is unified across variants (muted grey, dark text)
    // and overrides the variant's hover/shadow. Placed last so tailwind-merge
    // resolves bg/text/border conflicts in favour of the disabled look.
    disabled && [
      "cursor-not-allowed",
      "bg-seasalt-400 text-rich-black/70 border-seasalt-400/50",
      "hover:bg-seasalt-400 hover:text-rich-black/70 hover:border-seasalt-400/50",
      "shadow-none hover:shadow-none",
    ],
    className,
  );

  if ("href" in props && props.href) {
    const {
      href,
      prefetch,
      scroll,
      replace,
      download,
      "aria-current": ariaCurrent,
      "aria-label": ariaLabel,
    } = props;

    // Protocol-based and download links bypass the Next.js router - render as a plain <a>.
    // This includes file downloads, tel:, mailto:, and any other non-path hrefs.
    const isPassthrough =
      download !== undefined || (!href.startsWith("/") && !href.startsWith("#"));
    if (isPassthrough) {
      return (
        <a href={href} download={download} className={baseClasses} aria-label={ariaLabel}>
          {children}
        </a>
      );
    }

    return (
      <Link
        href={href}
        prefetch={prefetch}
        scroll={scroll}
        replace={replace}
        className={baseClasses}
        aria-current={ariaCurrent}
        aria-label={ariaLabel}
        // `disabled` here is visual only (opacity/cursor) - Link still navigates.
        // Use conditional rendering when the link should be truly inert.
      >
        {children}
      </Link>
    );
  }

  const {
    type = "button",
    onClick,
    "aria-label": ariaLabel,
    "aria-disabled": ariaDisabled,
    "aria-busy": ariaBusy,
  } = rest as ButtonAsButton;

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={baseClasses}
      aria-label={ariaLabel}
      aria-disabled={ariaDisabled ?? disabled}
      aria-busy={ariaBusy}
    >
      {children}
    </button>
  );
}
