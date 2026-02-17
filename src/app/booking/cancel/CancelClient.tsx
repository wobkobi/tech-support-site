// src/app/booking/cancel/CancelClient.tsx
"use client";
/**
 * @file CancelClient.tsx
 * @description Client UI for cancelling a booking.
 */

import type React from "react";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";

const CARD = "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-5 shadow-sm sm:p-6";

export interface BookingCancelClientProps {
  token?: string;
}

/**
 * Booking cancel page UI.
 * @param props - Component props.
 * @param props.token - The cancellation token from the URL.
 * @returns The cancel page element.
 */
export default function BookingCancelClient({
  token,
}: BookingCancelClientProps): React.ReactElement {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    /** Executes the cancellation API call. */
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
    <main className={cn("relative min-h-dvh overflow-hidden")}>
      {/* Backdrop */}
      <div className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden")}>
        <Image
          src="/source/backdrop.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className={cn("scale-110 transform-gpu object-cover blur-xl")}
        />
      </div>

      {/* Frosted container */}
      <div className={cn("mx-auto my-5 w-full max-w-[min(100vw-2rem,56rem)] sm:my-10")}>
        <div
          className={cn(
            "border-seasalt-400/40 bg-seasalt-800/60 rounded-2xl border p-5 shadow-lg backdrop-blur-xl sm:p-10",
          )}
        >
          <div className={cn("flex flex-col gap-4 sm:gap-5")}>
            <section className={cn(CARD)}>
              <h1 className={cn("text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl")}>
                Cancel booking
              </h1>

              {state === "loading" && <p className={cn("text-rich-black")}>Cancelling...</p>}

              {state !== "loading" && <p className={cn("text-rich-black")}>{message}</p>}

              <div className={cn("mt-4 flex flex-wrap gap-3")}>
                <Link
                  href="/"
                  className={cn(
                    "bg-russian-violet text-seasalt rounded-md px-4 py-2 text-sm font-semibold",
                    "hover:brightness-110",
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
          </div>
        </div>
      </div>
    </main>
  );
}
