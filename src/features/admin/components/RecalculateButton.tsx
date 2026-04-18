"use client";
// src/features/admin/components/RecalculateButton.tsx
import { useState, useCallback } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/shared/lib/cn";

interface RecalculateButtonProps {
  token: string;
}

/**
 * Client button that triggers the travel time recalculation API and shows the result.
 * @param props - Component props.
 * @param props.token - Admin token for the API request.
 * @returns Recalculate button element.
 */
export function RecalculateButton({ token }: RecalculateButtonProps): React.ReactElement {
  const router = useRouter();
  const [recalculating, setRecalculating] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRecalculating(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/travel/recalculate", {
        method: "POST",
        headers: { "X-Admin-Secret": token },
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
  }, [token, router]);

  return (
    <div className={cn("flex flex-wrap items-center gap-3")}>
      <button
        onClick={() => void run()}
        disabled={recalculating}
        className={cn(
          "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
          recalculating
            ? "cursor-not-allowed bg-slate-100 text-slate-400"
            : "bg-russian-violet hover:bg-russian-violet/90 text-white",
        )}
      >
        {recalculating ? "Recalculating…" : "Recalculate travel times"}
      </button>
      {result && <p className={cn("text-xs text-slate-500")}>{result}</p>}
    </div>
  );
}
