"use client";
// src/features/reviews/components/admin/CopyLinkButton.tsx
// Button that copies a review link to the clipboard.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useState } from "react";
import { ROW_BUTTON_CLS } from "./review-admin-classes";

/**
 * Props for the {@link CopyLinkButton} component.
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
    <AdminButton
      variant="secondary"
      onClick={handleCopy}
      className={cn(ROW_BUTTON_CLS, copied && "border-moonstone-600 text-moonstone-700")}
    >
      {copied ? "Copied!" : "Copy link"}
    </AdminButton>
  );
}
