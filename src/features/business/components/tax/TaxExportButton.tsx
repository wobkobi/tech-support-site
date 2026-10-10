"use client";
// src/features/business/components/tax/TaxExportButton.tsx
// Downloads one year's accountant CSV. Fetches it as a blob rather than linking to it, so a
// failed export shows a toast instead of the browser saving the error body as a .csv.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { useToast } from "@/features/admin/components/ui/Toast";
import type React from "react";
import { useState } from "react";

/**
 * "Download CSV" button for the accountant summary.
 * @param props - Component props.
 * @param props.fyKey - FY key to export, e.g. "2025-26".
 * @returns The button.
 */
export function TaxExportButton({ fyKey }: { fyKey: string }): React.ReactElement {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  /** Fetches the CSV and hands it to the browser's save dialog. */
  async function download(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/business/tax/export?fy=${encodeURIComponent(fyKey)}`);
      if (res.status === 401) {
        toast("You've been signed out. Sign in again, then try once more.", { tone: "error" });
        return;
      }
      if (!res.ok) {
        toast(`Export failed (error ${res.status}) - try again.`, { tone: "error" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tax-summary-${fyKey}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after 30s, not at once: some browsers (Firefox, Safari) read the blob after
      // click() returns, and revoking first can leave a failed or empty download.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      console.error("[TaxExportButton] Export error:", err);
      toast("Network error - the CSV didn't download.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminButton variant="secondary" onClick={() => void download()} busy={busy}>
      Download CSV
    </AdminButton>
  );
}
