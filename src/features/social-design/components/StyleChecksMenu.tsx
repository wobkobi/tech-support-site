"use client";
// src/features/social-design/components/StyleChecksMenu.tsx
// The editor's "Checks" dropdown: what may stop the picture reading well in a feed,
// with a Show button that opens the size and picks the layer. Warnings only; nothing
// here stops a picture being made or used.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import type { FormatKey } from "@/features/social-design/lib/formats";
import type { CheckKind, StyleIssue } from "@/features/social-design/lib/style-checks";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  FaCircleCheck,
  FaCircleHalfStroke,
  FaComments,
  FaEyeSlash,
  FaFaceSmile,
  FaHandPointer,
  FaTextHeight,
  FaTriangleExclamation,
} from "react-icons/fa6";

const KIND_ICON: Record<CheckKind, IconType> = {
  "small-text": FaTextHeight,
  "many-words": FaComments,
  covered: FaEyeSlash,
  button: FaHandPointer,
  emoji: FaFaceSmile,
  contrast: FaCircleHalfStroke,
};

/**
 * Checks dropdown.
 * @param props - Component props.
 * @param props.issues - What the checks found.
 * @param props.checkingContrast - Whether contrast is still being worked out.
 * @param props.onShow - Opens a size and picks a layer (null for the whole design).
 * @returns Menu element.
 */
export function StyleChecksMenu({
  issues,
  checkingContrast,
  onShow,
}: {
  issues: StyleIssue[];
  checkingContrast: boolean;
  onShow: (format: FormatKey, layerId: string | null) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    /**
     * Closes when the press lands outside the menu.
     * @param e - Pointer event.
     */
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const count = issues.length;
  return (
    <div ref={rootRef} className="relative">
      <AdminButton
        variant="outline"
        aria-expanded={open}
        title="Things that may stop the picture reading well in a feed"
        onClick={() => setOpen((o) => !o)}
      >
        {count > 0 ? (
          <FaTriangleExclamation aria-hidden className="size-3 text-mustard-700" />
        ) : (
          <FaCircleCheck aria-hidden className="size-3 text-moonstone-700" />
        )}
        Checks
        {count > 0 && (
          <span className="rounded-full bg-mustard-200 px-1.5 text-sm font-semibold text-admin-text">
            {count}
          </span>
        )}
      </AdminButton>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-1 flex max-h-[60vh] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-y-auto rounded-lg border border-admin-border bg-admin-surface p-2 shadow-lg">
          <p className="px-2 pb-2 text-sm text-admin-text-secondary">
            Things that may stop the picture reading well in a feed. None of them stop you using it.
          </p>
          {count === 0 && (
            <p className="px-2 pb-1 text-sm text-admin-text">
              {checkingContrast ? "Nothing so far." : "All clear on every size."}
            </p>
          )}
          <ul className="flex flex-col">
            {issues.map((issue) => {
              const Icon = KIND_ICON[issue.kind];
              const first = issue.formats[0];
              return (
                <li
                  key={`${issue.kind}:${issue.layerId ?? "all"}:${issue.formats.join()}`}
                  className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-admin-bg"
                >
                  <Icon aria-hidden className="mt-1 size-3.5 shrink-0 text-mustard-700" />
                  <p className="min-w-0 flex-1 text-sm text-admin-text">{issue.message}</p>
                  {first && (
                    <AdminButton
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        onShow(first, issue.layerId);
                        setOpen(false);
                      }}
                    >
                      Show
                    </AdminButton>
                  )}
                </li>
              );
            })}
          </ul>
          <p
            role="status"
            className={cn("px-2 pt-1 text-sm text-admin-muted", !checkingContrast && "sr-only")}
          >
            {checkingContrast ? "Checking the words stand out from what's behind them..." : ""}
          </p>
        </div>
      )}
    </div>
  );
}
