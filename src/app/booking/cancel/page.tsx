// src/app/booking/cancel/page.tsx
/**
 * @file page.tsx
 * @description Booking cancel page. Server-side renders the magic-link landing
 * with a confirmation gate so the customer sees the cancellation-fee banner
 * before the cancel actually fires. Previous version auto-fired on mount,
 * which gave the customer no chance to back out of a mis-click and no
 * chance to see the fee disclosure.
 */

"use client";

import type React from "react";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/components/Button";
import {
  CANCELLATION,
  isWithinCancellationWindow,
  isWithinTravelWindow,
} from "@/features/business/lib/pricing-policy";
import { formatDateShort } from "@/shared/lib/date-format";

const CARD = "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-5 shadow-sm sm:p-6";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; startAt: Date }
  | { kind: "alreadyCancelled" }
  | { kind: "error"; message: string };

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "done" }
  | { kind: "error"; message: string };

/**
 * Pre-cancellation banner. Three states driven by the policy window helpers
 * - green when the cancel is free, amber when only the callout fee applies,
 * red when travel is also added. Empty when the booking is already cancelled.
 * @param props - Component props.
 * @param props.startAt - Booking start time.
 * @returns Banner element appropriate for the current cancellation timing.
 */
function FeeBanner({ startAt }: { startAt: Date }): React.ReactElement {
  const now = new Date();
  const inTravel = isWithinTravelWindow(startAt, now);
  const inCancel = isWithinCancellationWindow(startAt, now);
  if (inTravel) {
    return (
      <div
        role="alert"
        className={cn(
          "border-coquelicot-500/60 bg-coquelicot-50 text-rich-black rounded-lg border-2 p-4 text-sm sm:text-base",
        )}
      >
        <strong>${CANCELLATION.callOutFee} call-out fee plus round-trip travel</strong> will apply -
        we're inside the {CANCELLATION.travelChargeHours}-hour window when I would normally be on
        the way to you. Please call or text me directly if anything has changed.
      </div>
    );
  }
  if (inCancel) {
    return (
      <div
        role="alert"
        className={cn(
          "border-mustard-500/60 bg-mustard-900/40 text-rich-black rounded-lg border-2 p-4 text-sm sm:text-base",
        )}
      >
        <strong>${CANCELLATION.callOutFee} call-out fee</strong> will apply - you're inside the{" "}
        {CANCELLATION.freeNoticeHours}-hour cancellation window.
      </div>
    );
  }
  return (
    <div
      className={cn(
        "border-moonstone-500/50 bg-moonstone-600/10 text-rich-black rounded-lg border-2 p-4 text-sm sm:text-base",
      )}
    >
      <strong>No fee</strong> applies for this cancellation - thanks for the heads up.
    </div>
  );
}

/**
 * Inner content component. Wrapped in Suspense by the page export because
 * useSearchParams requires it.
 * @returns The cancel UI element.
 */
function CancelContent(): React.ReactElement {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? undefined;
  // Initialise from the token presence so we never call setState
  // synchronously inside the effect (react-hooks/set-state-in-effect).
  const [load, setLoad] = useState<LoadState>(() =>
    token ? { kind: "loading" } : { kind: "error", message: "Missing cancel token." },
  );
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    /** Loads the booking's startAt + status so the banner can render. */
    async function loadInfo(): Promise<void> {
      try {
        const res = await fetch(`/api/booking/cancel?token=${encodeURIComponent(token!)}`, {
          method: "GET",
        });
        const data = (await res.json()) as {
          ok?: boolean;
          startAt?: string;
          status?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!data.ok || !data.startAt) {
          setLoad({ kind: "error", message: data.error || "Booking not found." });
          return;
        }
        if (data.status === "cancelled") {
          setLoad({ kind: "alreadyCancelled" });
          return;
        }
        setLoad({ kind: "ready", startAt: new Date(data.startAt) });
      } catch {
        if (cancelled) return;
        setLoad({ kind: "error", message: "Network error." });
      }
    }
    void loadInfo();
    return () => {
      cancelled = true;
    };
  }, [token]);

  /** Fires the actual cancellation POST after the user confirms. */
  async function runCancel(): Promise<void> {
    if (!token) {
      setSubmit({ kind: "error", message: "Missing cancel token." });
      return;
    }
    setSubmit({ kind: "submitting" });
    try {
      const res = await fetch("/api/booking/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelToken: token }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setSubmit({ kind: "done" });
      } else {
        setSubmit({ kind: "error", message: data.error || "Could not cancel booking." });
      }
    } catch {
      setSubmit({ kind: "error", message: "Network error." });
    }
  }

  return (
    <main className={cn("relative min-h-dvh overflow-hidden")}>
      {/* Backdrop */}
      <div className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden")}>
        <picture>
          <source type="image/avif" srcSet="/source/backdrop-blur.avif" />
          <img
            src="/source/backdrop-blur.webp"
            alt=""
            fetchPriority="high"
            decoding="async"
            className={cn("absolute inset-0 h-full w-full scale-110 transform-gpu object-cover")}
          />
        </picture>
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

              {load.kind === "loading" && (
                <p className={cn("text-rich-black")}>Loading booking details...</p>
              )}

              {load.kind === "error" && <p className={cn("text-rich-black")}>{load.message}</p>}

              {load.kind === "alreadyCancelled" && (
                <p className={cn("text-rich-black")}>
                  This booking has already been cancelled - no further action needed.
                </p>
              )}

              {load.kind === "ready" && submit.kind === "done" && (
                <p className={cn("text-rich-black")}>
                  Booking cancelled. A confirmation email will follow shortly.
                </p>
              )}

              {load.kind === "ready" && submit.kind !== "done" && (
                <div className={cn("space-y-4")}>
                  <p className={cn("text-rich-black")}>
                    You're about to cancel your appointment for{" "}
                    <strong>{formatDateShort(load.startAt)}</strong>.
                  </p>
                  <FeeBanner startAt={load.startAt} />
                  {submit.kind === "error" && (
                    <p className={cn("text-coquelicot-500 text-sm")}>{submit.message}</p>
                  )}
                  <div className={cn("flex flex-wrap gap-3")}>
                    <button
                      type="button"
                      onClick={() => void runCancel()}
                      disabled={submit.kind === "submitting"}
                      className={cn(
                        "bg-coquelicot-500 hover:bg-coquelicot-600 rounded-xl px-5 py-2.5 text-base font-semibold text-white transition-colors disabled:opacity-50",
                      )}
                    >
                      {submit.kind === "submitting" ? "Cancelling..." : "Confirm cancellation"}
                    </button>
                    <Button href="/" variant="secondary" size="sm">
                      Keep my booking
                    </Button>
                  </div>
                </div>
              )}

              {(load.kind === "alreadyCancelled" ||
                load.kind === "error" ||
                submit.kind === "done") && (
                <div className={cn("mt-4 flex flex-wrap gap-3")}>
                  <Button href="/" variant="secondary" size="sm">
                    Back to home
                  </Button>
                  <Button href="/booking" variant="ghost" size="sm">
                    Book another time
                  </Button>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * Booking cancel page. Suspense is required because CancelContent uses useSearchParams.
 * @returns The cancel page element.
 */
export default function BookingCancelPage(): React.ReactElement {
  return (
    <Suspense>
      <CancelContent />
    </Suspense>
  );
}
