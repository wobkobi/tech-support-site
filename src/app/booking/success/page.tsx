// src/app/booking/success/page.tsx
/**
 * @file page.tsx
 * @description Booking request success page.
 */

import type React from "react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { FaCircleCheck, FaHouse } from "react-icons/fa6";

const CARD = "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-5 shadow-sm sm:p-6";

/**
 * Booking success page component.
 */
export default function BookingSuccessPage(): React.ReactElement {
  return (
    <main className={cn("relative min-h-dvh overflow-hidden")}>
      {/* Backdrop */}
      <div className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden")}>
        <Image
          src="/backdrop.jpg"
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
            <section className={cn(CARD, "text-center")}>
              <div className={cn("mb-4 flex justify-center")}>
                <FaCircleCheck className={cn("text-moonstone-600 h-16 w-16")} aria-hidden />
              </div>

              <h1
                className={cn(
                  "text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl md:text-4xl",
                )}
              >
                Request received!
              </h1>

              <p className={cn("text-rich-black/80 mb-6 text-sm sm:text-base")}>
                Thanks for your booking request. I'll check my schedule and get back to you shortly
                with a confirmed time. You'll receive a calendar invite once it's locked in.
              </p>

              <Link
                href="/"
                className={cn(
                  "bg-russian-violet text-seasalt inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold",
                  "hover:brightness-110",
                )}
              >
                <FaHouse className={cn("h-4 w-4")} aria-hidden />
                Back to home
              </Link>
            </section>

            <section className={cn(CARD)}>
              <h2 className={cn("text-russian-violet mb-2 text-lg font-bold sm:text-xl")}>
                What happens next?
              </h2>
              <ol
                className={cn(
                  "text-rich-black/80 list-inside list-decimal space-y-1 text-sm sm:text-base",
                )}
              >
                <li>I'll review your request and find a time that works</li>
                <li>You'll get an email with the confirmed appointment details</li>
                <li>A Google Calendar invite will be sent so you don't forget</li>
                <li>Need to change something? Just reply to the email</li>
              </ol>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
