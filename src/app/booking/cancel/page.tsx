// src/app/booking/cancel/page.tsx
/**
 * @file page.tsx
 * @description Booking cancel page. Confirmation gate with a three-state
 * fee banner so the customer sees the cancellation cost before they fire
 * the cancel.
 */

"use client";

import {
  CANCELLATION,
  isWithinCancellationWindow,
  isWithinTravelWindow,
} from "@/features/business/lib/pricing-policy";
import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import { useSearchParams } from "next/navigation";
import type React from "react";
import { Suspense, useEffect, useState } from "react";

const CARD = "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-5 shadow-sm sm:p-6";

/** Live cancellation figures handed down from the cancel-info API. */
interface CancellationInfo {
  freeNoticeHours: number;
  travelChargeHours: number;
  callOutFee: number;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; startAt: Date; policy: CancellationInfo }
  | { kind: "alreadyCancelled" }
  | { kind: "error"; message: string };

type SubmitState =
  { kind: "idle" } | { kind: "submitting" } | { kind: "done" } | { kind: "error"; message: string };

/**
 * Pre-cancellation fee banner. Green = no fee, amber = call-out fee,
 * red = call-out fee + round-trip travel. Figures come from the live policy.
 * @param props - Component props.
 * @param props.startAt - Booking start time.
 * @param props.policy - Live cancellation figures from the cancel-info API.
 * @returns Banner element for the current cancellation timing.
 */
function FeeBanner({
  startAt,
  policy,
}: {
  startAt: Date;
  policy: CancellationInfo;
}): React.ReactElement {
  const now = new Date();
  const inTravel = isWithinTravelWindow(startAt, now, policy.travelChargeHours);
  const inCancel = isWithinCancellationWindow(startAt, now, policy.freeNoticeHours);
  if (inTravel) {
    return (
      <div
        role="alert"
        className="bg-coquelicot-50 rounded-lg border-2 border-coquelicot-500/60 p-4 text-sm text-rich-black sm:text-base"
      >
        <strong>${policy.callOutFee} call-out fee plus round-trip travel</strong> will apply - we're
        inside the {policy.travelChargeHours}-hour window when I would normally be on the way to
        you. Please call or text me directly if anything has changed.
      </div>
    );
  }
  if (inCancel) {
    return (
      <div
        role="alert"
        className="rounded-lg border-2 border-mustard-500/60 bg-mustard-900/40 p-4 text-sm text-rich-black sm:text-base"
      >
        <strong>${policy.callOutFee} call-out fee</strong> will apply - you're inside the{" "}
        {policy.freeNoticeHours}-hour cancellation window.
      </div>
    );
  }
  return (
    <div className="rounded-lg border-2 border-moonstone-500/50 bg-moonstone-600/10 p-4 text-sm text-rich-black sm:text-base">
      <strong>No fee</strong> applies for this cancellation - thanks for the heads up.
    </div>
  );
}

/**
 * Inner content component. Wrapped in {@link Suspense} by the page export because
 * {@link useSearchParams} requires it.
 * @returns The cancel UI element.
 */
function CancelContent(): React.ReactElement {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? undefined;
  // Seed from token presence so the effect doesn't synchronously setState
  // (react-hooks/set-state-in-effect).
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
          cancellation?: CancellationInfo;
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
        setLoad({
          kind: "ready",
          startAt: new Date(data.startAt),
          policy: data.cancellation ?? CANCELLATION,
        });
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
    <main className="relative min-h-dvh overflow-hidden">
      {/* Backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <picture>
          <source type="image/avif" srcSet="/source/backdrop-blur.avif" />
          <img
            src="/source/backdrop-blur.webp"
            alt=""
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 h-full w-full scale-110 transform-gpu object-cover"
          />
        </picture>
      </div>

      {/* Frosted container */}
      <div className="mx-auto my-5 w-full max-w-[min(100vw-2rem,56rem)] sm:my-10">
        <div className="rounded-2xl border border-seasalt-400/40 bg-seasalt-800/60 p-5 shadow-lg backdrop-blur-xl sm:p-10">
          <div className="flex flex-col gap-4 sm:gap-5">
            <section className={cn(CARD)}>
              <h1 className="mb-3 text-2xl font-extrabold text-russian-violet sm:text-3xl">
                Cancel booking
              </h1>

              {load.kind === "loading" && (
                <p className="text-rich-black">Loading booking details...</p>
              )}

              {load.kind === "error" && <p className="text-rich-black">{load.message}</p>}

              {load.kind === "alreadyCancelled" && (
                <p className="text-rich-black">
                  This booking has already been cancelled - no further action needed.
                </p>
              )}

              {load.kind === "ready" && submit.kind === "done" && (
                <p className="text-rich-black">
                  Booking cancelled. A confirmation email will follow shortly.
                </p>
              )}

              {load.kind === "ready" && submit.kind !== "done" && (
                <div className="space-y-4">
                  <p className="text-rich-black">
                    You're about to cancel your appointment for{" "}
                    <strong>{formatDateShort(load.startAt)}</strong>.
                  </p>
                  <FeeBanner startAt={load.startAt} policy={load.policy} />
                  {submit.kind === "error" && (
                    <p className="text-sm text-coquelicot-500">{submit.message}</p>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void runCancel()}
                      disabled={submit.kind === "submitting"}
                      className="rounded-xl bg-coquelicot-500 px-5 py-2.5 text-base font-semibold text-white transition-colors hover:bg-coquelicot-600 disabled:opacity-50"
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
                <div className="mt-4 flex flex-wrap gap-3">
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
 * Booking cancel page. {@link Suspense} is required because {@link CancelContent} uses {@link useSearchParams}.
 * @returns The cancel page element.
 */
export default function BookingCancelPage(): React.ReactElement {
  return (
    <Suspense>
      <CancelContent />
    </Suspense>
  );
}
