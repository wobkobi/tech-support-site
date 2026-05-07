"use client";

import type React from "react";
import Link from "next/link";
import { cn } from "@/shared/lib/cn";

interface InvoiceActionsProps {
  backHref: string;
  driveWebUrl: string | null;
}

/**
 * Action bar for an invoice detail page with back, print, and Drive PDF links.
 * @param props - Component props
 * @param props.backHref - URL for the back button
 * @param props.driveWebUrl - Optional Google Drive PDF URL
 * @returns Invoice actions element
 */
export function InvoiceActions({ backHref, driveWebUrl }: InvoiceActionsProps): React.ReactElement {
  return (
    <div className={cn("mb-6 flex flex-wrap gap-3 print:hidden")}>
      <Link
        href={backHref}
        className={cn(
          "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50",
        )}
      >
        ← Back
      </Link>
      <button
        onClick={() => window.print()}
        className={cn(
          "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50",
        )}
      >
        Print / save PDF
      </button>
      {driveWebUrl && (
        <a
          href={driveWebUrl}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50",
          )}
        >
          View PDF in Drive ↗
        </a>
      )}
    </div>
  );
}
