// src/shared/components/Button.tsx
/**
 * @file Button.tsx
 * @description Polymorphic button component with consistent variants and sizes.
 */

"use client";

import type React from "react";
import Link from "next/link";
import { cn } from "@/shared/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

/**
 * Button props when rendering as a Next.js Link (href present)
 */
interface ButtonAsLink {
  href: string;
  // Next.js Link props
  prefetch?: boolean;
  scroll?: boolean;
  replace?: boolean;
  /**
   * When set, renders as a plain <a> with the download attribute instead of a Next.js Link.
   * Use for file downloads so the browser handles them directly without the router.
   */
  download?: string;
  // Button-specific props
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
  // Accessibility
  "aria-current"?: "page" | "step" | "location" | "date" | "time" | "true" | "false";
  "aria-label"?: string;
}

/**
 * Button props when rendering as a native button element (no href)
 */
interface ButtonAsButton {
  href?: never; // explicitly exclude href
  // Native button props
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  // Button-specific props
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
  children: React.ReactNode;
  // Accessibility
  "aria-label"?: string;
  "aria-disabled"?: boolean;
}

export type ButtonProps = ButtonAsLink | ButtonAsButton;

/**
 * Get variant-specific classes
 * @param variant - Button variant type
 * @returns Tailwind class string for the variant
 */
function getVariantClasses(variant: ButtonVariant): string {
  switch (variant) {
    case "primary":
      return cn("bg-coquelicot-500 text-seasalt", "hover:bg-coquelicot-600", "transition-colors");
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
 * Get size-specific classes
 * @param size - Button size type
 * @returns Tailwind class string for the size
 */
function getSizeClasses(size: ButtonSize): string {
  switch (size) {
    case "sm":
      return cn("h-9 px-4 text-sm");
    case "md":
      return cn("h-12 px-5 text-base");
    case "lg":
      return cn("h-14 px-6 text-lg");
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

  // Base classes shared by all buttons
  const baseClasses = cn(
    "inline-flex items-center justify-center gap-2",
    "rounded-lg font-bold",
    "whitespace-nowrap",
    fullWidth && "w-full",
    disabled && "opacity-60 cursor-not-allowed",
    getVariantClasses(variant),
    getSizeClasses(size),
    className,
  );

  // Discriminate based on href presence
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

    // Protocol-based and download links bypass the Next.js router — render as a plain <a>.
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
        // Note: disabled is applied via className (opacity/cursor)
        // Link will still navigate - use conditional rendering if truly disabled
      >
        {children}
      </Link>
    );
  }

  // Render as button
  const {
    type = "button",
    onClick,
    "aria-label": ariaLabel,
    "aria-disabled": ariaDisabled,
  } = rest as ButtonAsButton;

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={baseClasses}
      aria-label={ariaLabel}
      aria-disabled={ariaDisabled ?? disabled}
    >
      {children}
    </button>
  );
}
