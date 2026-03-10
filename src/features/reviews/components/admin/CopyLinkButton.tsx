"use client";
// src/features/reviews/components/admin/CopyLinkButton.tsx
/**
 * @file CopyLinkButton.tsx
 * @description Button that copies a review link to the clipboard.
 */

import { useState } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Props for CopyLinkButton component.
 */
interface CopyLinkButtonProps {
  /** The full review URL to copy */
  url: string;
}

/**
 * Button that copies a review URL to the clipboard.
 * @param props - Component props.
 * @param props.url - The review URL to copy.
 * @returns Copy link button element.
 */
export function CopyLinkButton({ url }: CopyLinkButtonProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

  /** Copies the URL to the clipboard and shows brief confirmation. */
  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "rounded-md px-2 py-1 text-xs font-semibold transition-colors",
        copied
          ? "bg-moonstone-600/20 text-moonstone-600"
          : "bg-russian-violet/10 text-russian-violet hover:bg-russian-violet/20",
      )}
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
