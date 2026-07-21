// src/features/admin/components/ui/Modal.tsx
/**
 * @description Shared admin dialog shell: backdrop-click and Escape close it,
 * focus moves into the dialog on open, body scroll locks while open, and the
 * whole overlay is `print:hidden`. Extracted from the two structurally-identical
 * modals in InvoiceActions. It appears without motion; a fade added later must
 * use `transition-[opacity]` (Tailwind v4 compiles translate/scale to separate
 * longhand props, so a transform-based transition would silently no-op).
 */

"use client";

import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useEffect, useId, useRef } from "react";

/** Dialog width. */
type ModalSize = "sm" | "md" | "lg";

/** Props for {@link Modal}. */
interface ModalProps {
  /** Whether the dialog is shown. */
  open: boolean;
  /** Called on backdrop click, Escape, or the close button. */
  onClose: () => void;
  /** Dialog title (also the accessible name). */
  title: React.ReactNode;
  /** Optional description under the title. */
  description?: React.ReactNode;
  /** Optional footer (usually action buttons). */
  footer?: React.ReactNode;
  /** Dialog width (defaults to "md"). */
  size?: ModalSize;
  children: React.ReactNode;
}

/**
 * Max-width class for the given size.
 * @param size - Dialog size.
 * @returns Class string.
 */
function sizeClass(size: ModalSize): string {
  switch (size) {
    case "sm":
      return "max-w-md";
    case "md":
      return "max-w-lg";
    case "lg":
      return "max-w-2xl";
  }
}

/**
 * Accessible modal dialog. Renders nothing when closed.
 * @param props - Component props.
 * @param props.open - Whether the dialog is shown.
 * @param props.onClose - Dismiss handler.
 * @param props.title - Dialog title / accessible name.
 * @param props.description - Optional description under the title.
 * @param props.footer - Optional footer content.
 * @param props.size - Dialog width.
 * @param props.children - Dialog body.
 * @returns The dialog element, or null when closed.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  size = "md",
  children,
}: ModalProps): React.ReactElement | null {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // While open: lock body scroll, move focus into the dialog (restored to the
    // trigger on close), and close on Escape.
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    /**
     * Closes the dialog on Escape.
     * @param e - The keyboard event.
     */
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl border border-admin-border bg-admin-surface shadow-xl outline-none",
          sizeClass(size),
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-admin-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold text-russian-violet">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-0.5 text-sm text-admin-text-secondary">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 text-2xl leading-none text-admin-faint transition-colors hover:text-admin-text"
          >
            &times;
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-admin-border bg-admin-bg px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
