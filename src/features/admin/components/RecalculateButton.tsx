"use client";
// src/features/admin/components/RecalculateButton.tsx
/**
 * @description Client button that POSTs to the travel recalculation API, then
 * shows the cached-event count or an error and refreshes the route.
 */
import { cn } from "@/shared/lib/cn";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useState } from "react";

/**
 * Client button that triggers the travel time recalculation API and shows the result.
 * @returns Recalculate button element.
 */
export function RecalculateButton(): React.ReactElement {
  const router = useRouter();
  const [recalculating, setRecalculating] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRecalculating(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/travel/recalculate", {
        method: "POST",
        headers: {},
      });
      const data = (await res.json()) as { ok: boolean; cachedCount?: number; error?: string };
      if (data.ok) {
        setResult(`Done - ${data.cachedCount ?? 0} events cached.`);
        router.refresh();
      } else {
        setResult(`Error: ${data.error ?? "unknown"}`);
      }
    } catch {
      setResult("Network error - try again.");
    } finally {
      setRecalculating(false);
    }
  }, [router]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={() => void run()}
        disabled={recalculating}
        className={cn(
          "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
          recalculating
            ? "cursor-not-allowed bg-slate-100 text-slate-400"
            : "bg-russian-violet text-white hover:bg-russian-violet/90",
        )}
      >
        {recalculating ? "Recalculating…" : "Recalculate travel times"}
      </button>
      {result && <p className="text-xs text-slate-500">{result}</p>}
    </div>
  );
}
