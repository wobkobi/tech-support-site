"use client";
// src/app/booking/cancel/CancelContent.tsx
// Cancel flow: a confirmation gate with a three-state fee banner, so the customer sees
// the cancellation cost before they fire the cancel.

import {
  CANCELLATION,
  isWithinCancellationWindow,
  isWithinTravelWindow,
} from "@/features/business/lib/pricing-policy";
import { Button } from "@/shared/components/Button";
import { CARD } from "@/shared/components/PageLayout";
import { PhoneLink } from "@/shared/components/PhoneLink";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeLong } from "@/shared/lib/date-format";
import { useSearchParams } from "next/navigation";
import type React from "react";
import { useEffect, useState } from "react";

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

/** Props shared by the cancel flow's pieces that offer the phone number. */
interface PhoneProps {
  /** Display phone number. */
  phone: string;
  /** tel: URI for the same number. */
  phoneTel: string;
}

/**
 * Pre-cancellation fee banner. Green = no fee, amber = call-out fee,
 * red = call-out fee + round-trip travel. Figures come from the live policy.
 * @param props - Component props.
 * @param props.startAt - Booking start time.
 * @param props.policy - Live cancellation figures from the cancel-info API.
 * @param props.phone - Display phone number.
 * @param props.phoneTel - tel: URI for the same number.
 * @returns Banner element for the current cancellation timing.
 */
function FeeBanner({
  startAt,
  policy,
  phone,
  phoneTel,
}: PhoneProps & { startAt: Date; policy: CancellationInfo }): React.ReactElement {
  const now = new Date();
  const inTravel = isWithinTravelWindow(startAt, now, policy.travelChargeHours);
  const inCancel = isWithinCancellationWindow(startAt, now, policy.freeNoticeHours);
  if (inTravel) {
    return (
      <div
        role="alert"
        className="rounded-lg border-2 border-coquelicot-500/60 bg-coquelicot-50 p-4 text-base text-rich-black sm:text-lg"
      >
        <strong>${policy.callOutFee} call-out fee plus round-trip travel</strong> will apply - we're
        inside the {policy.travelChargeHours}-hour window when I would normally be on the way to
        you. If anything has changed, call or text me on{" "}
        <PhoneLink phone={phone} phoneTel={phoneTel} /> first.
      </div>
    );
  }
  if (inCancel) {
    return (
      <div
        role="alert"
        className="rounded-lg border-2 border-mustard-300/60 bg-mustard-50/40 p-4 text-base text-rich-black sm:text-lg"
      >
        <strong>${policy.callOutFee} call-out fee</strong> will apply - you're inside the{" "}
        {policy.freeNoticeHours}-hour cancellation window.
      </div>
    );
  }
  return (
    <div className="rounded-lg border-2 border-moonstone-500/50 bg-moonstone-400/10 p-4 text-base text-rich-black sm:text-lg">
      <strong>No fee</strong> applies for this cancellation - thanks for the heads up.
    </div>
  );
}

/**
 * The way out of a dead end: fresh links by email, or the phone.
 * @param props - Component props.
 * @param props.message - What went wrong, in plain words.
 * @param props.phone - Display phone number.
 * @param props.phoneTel - tel: URI for the same number.
 * @returns The error block.
 */
function CancelProblem({
  message,
  phone,
  phoneTel,
}: PhoneProps & { message: string }): React.ReactElement {
  return (
    <div role="alert" className="space-y-4">
      <p className="text-base font-medium text-error sm:text-lg">{message}</p>
      <p className="text-base text-rich-black sm:text-lg">
        I can email you fresh links to change or cancel, or you can call or text me on{" "}
        <PhoneLink phone={phone} phoneTel={phoneTel} /> and I'll sort it out.
      </p>
      <Button href="/booking/manage" variant="secondary" size="md">
        Email me fresh links
      </Button>
    </div>
  );
}

/**
 * The cancel flow. Wrapped in Suspense by the page because {@link useSearchParams}
 * requires it.
 * @param props - Component props.
 * @param props.phone - Display phone number.
 * @param props.phoneTel - tel: URI for the same number.
 * @returns The cancel UI element.
 */
export function CancelContent({ phone, phoneTel }: PhoneProps): React.ReactElement {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? undefined;
  // Seed from token presence so the effect doesn't synchronously setState
  // (react-hooks/set-state-in-effect).
  const [load, setLoad] = useState<LoadState>(() =>
    token
      ? { kind: "loading" }
      : { kind: "error", message: "This cancel link is missing part of its address." },
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
          setLoad({
            kind: "error",
            message:
              res.status === 404
                ? "I couldn't find a booking for this link. It may be from an older email."
                : (data.error ?? "Your booking couldn't be loaded just now."),
          });
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
        setLoad({
          kind: "error",
          message: "Your booking couldn't be loaded - check your connection and try again.",
        });
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
      setSubmit({ kind: "error", message: "This cancel link is missing part of its address." });
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
        // A 500's message is the server's shorthand, not something to show a customer.
        setSubmit({
          kind: "error",
          message:
            res.status >= 500 || !data.error
              ? "Your booking couldn't be cancelled just now."
              : data.error,
        });
      }
    } catch {
      setSubmit({
        kind: "error",
        message: "Your booking couldn't be cancelled - check your connection and try again.",
      });
    }
  }

  return (
    <main id="main" className="relative min-h-dvh overflow-hidden">
      {/* Backdrop */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
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
        <div className="rounded-2xl border border-seasalt-200/40 bg-white/60 p-5 shadow-lg backdrop-blur-xl sm:p-10">
          <div className="flex flex-col gap-4 sm:gap-5">
            <section className={cn(CARD)}>
              <h1 className="mb-3 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl">
                Cancel booking
              </h1>

              {load.kind === "loading" && (
                <p className="text-base text-rich-black">Loading booking details...</p>
              )}

              {load.kind === "error" && (
                <CancelProblem message={load.message} phone={phone} phoneTel={phoneTel} />
              )}

              {load.kind === "alreadyCancelled" && (
                <p className="text-base text-rich-black">
                  This booking has already been cancelled - no further action needed.
                </p>
              )}

              {load.kind === "ready" && submit.kind === "done" && (
                <p role="status" className="text-base text-rich-black sm:text-lg">
                  Booking cancelled. A confirmation email will follow shortly.
                </p>
              )}

              {load.kind === "ready" && submit.kind !== "done" && (
                <div className="space-y-4">
                  <p className="text-base text-rich-black sm:text-lg">
                    You're about to cancel your appointment on{" "}
                    <strong>{formatDateTimeLong(load.startAt)}</strong>.
                  </p>
                  <FeeBanner
                    startAt={load.startAt}
                    policy={load.policy}
                    phone={phone}
                    phoneTel={phoneTel}
                  />
                  {submit.kind === "error" && (
                    <CancelProblem message={submit.message} phone={phone} phoneTel={phoneTel} />
                  )}
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="primary"
                      size="md"
                      onClick={() => void runCancel()}
                      disabled={submit.kind === "submitting"}
                      aria-busy={submit.kind === "submitting"}
                    >
                      {submit.kind === "submitting" ? "Cancelling..." : "Confirm cancellation"}
                    </Button>
                    {/* Moving the appointment is usually what someone actually
                        wants when they land here - offer it before cancelling. */}
                    {token && (
                      <Button
                        href={`/booking/edit?token=${encodeURIComponent(token)}`}
                        variant="secondary"
                        size="md"
                      >
                        Reschedule instead
                      </Button>
                    )}
                    <Button href="/" variant="ghost" size="md">
                      Keep my booking
                    </Button>
                  </div>
                </div>
              )}

              {(load.kind === "alreadyCancelled" ||
                load.kind === "error" ||
                submit.kind === "done") && (
                <div className="mt-4 flex flex-wrap gap-3">
                  {/* Beside an error, "Email me fresh links" is the filled button;
                      a second filled one would compete with it. */}
                  <Button
                    href="/"
                    variant={load.kind === "error" ? "ghost" : "secondary"}
                    size="md"
                  >
                    Back to home
                  </Button>
                  <Button href="/booking" variant="ghost" size="md">
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
