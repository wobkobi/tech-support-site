"use client";
// src/features/admin/components/RecalculateButton.tsx
// Client button that POSTs to the travel recalculation API, then shows the cached-event
// count or an error and refreshes the route.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { useToast } from "@/features/admin/components/ui/Toast";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useState } from "react";

/**
 * Client button that triggers the travel time recalculation API and shows the result.
 * @returns Recalculate button element.
 */
export function RecalculateButton(): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [recalculating, setRecalculating] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRecalculating(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/travel/recalculate", {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok: boolean;
        cachedCount?: number;
        failedCalendars?: number;
        error?: string;
      };
      if (data.ok) {
        const failed = data.failedCalendars ?? 0;
        // A calendar that failed to read kept its old blocks, so say so rather than "done".
        const skipped = failed
          ? ` ${failed} calendar${failed === 1 ? "" : "s"} couldn't be read and kept the old times.`
          : "";
        setResult(`Done - ${data.cachedCount ?? 0} events cached.${skipped}`);
        toast(`Travel times recalculated - ${data.cachedCount ?? 0} events cached.${skipped}`, {
          tone: failed ? "warning" : "success",
        });
        router.refresh();
      } else {
        setResult(`Error: ${data.error ?? "unknown"}`);
        toast(data.error ?? "Couldn't recalculate travel times.", { tone: "error" });
      }
    } catch {
      setResult("Network error - try again.");
      toast("Network error - the recalculation didn't finish.", { tone: "error" });
    } finally {
      setRecalculating(false);
    }
  }, [router, toast]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <AdminButton
        type="button"
        variant="primary"
        busy={recalculating}
        disabled={recalculating}
        onClick={() => void run()}
      >
        {recalculating ? "Recalculating…" : "Recalculate travel times"}
      </AdminButton>
      {result && <p className="text-sm text-admin-muted">{result}</p>}
    </div>
  );
}
