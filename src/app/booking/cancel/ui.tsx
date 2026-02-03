// src/app/booking/cancel/ui.tsx
"use client";
/**
 * @file ui.tsx
 * @description Client UI for cancelling a booking.
 */

import type React from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PageShell, FrostedSection, PAGE_MAIN, CARD } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";

/**
 * Props for cancel client.
 */
export interface BookingCancelClientProps {
  /** Cancel token from URL. */
  token?: string;
}

/**
 * Booking cancel page UI.
 * @param root0 - Component props.
 * @param root0.token - Cancel token.
 * @returns Cancel page element.
 */
export default function BookingCancelClient({ token }: BookingCancelClientProps): React.ReactElement {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    /**
     * Run the cancellation.
     */
    async function runCancel(): Promise<void> {
      if (!token) {
        setState("error");
        setMessage("Missing cancel token.");
        return;
      }

      setState("loading");

      try {
        const res = await fetch("/api/booking/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cancelToken: token }),
        });

        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (cancelled) return;

        if (data.ok) {
          setState("done");
          setMessage("Booking cancelled successfully.");
        } else {
          setState("error");
          setMessage(data.error || "Could not cancel booking.");
        }
      } catch {
        if (cancelled) return;
        setState("error");
        setMessage("Network error.");
      }
    }

    void runCancel();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <PageShell>
      <FrostedSection>
        <main className={cn(PAGE_MAIN)}>
          <section className={cn(CARD)}>
            <h1
              className={cn("text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl")}
            >
              Cancel booking
            </h1>

            {state === "loading" && (
              <p className={cn("text-rich-black")}>Cancelling...</p>
            )}

            {state !== "loading" && (
              <p className={cn("text-rich-black")}>{message}</p>
            )}

            <div className={cn("mt-4 flex flex-wrap gap-3")}>
              <Link
                href="/"
                className={cn(
                  "bg-russian-violet text-seasalt rounded-md px-4 py-2 text-sm font-semibold",
                )}
              >
                Back to home
              </Link>
              <Link
                href="/booking"
                className={cn(
                  "border-seasalt-400/60 text-rich-black hover:bg-seasalt-900/40 rounded-md border px-4 py-2 text-sm font-semibold",
                )}
              >
                Book another time
              </Link>
            </div>
          </section>
        </main>
      </FrostedSection>
    </PageShell>
  );
}
