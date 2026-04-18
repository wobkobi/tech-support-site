// src/app/error.tsx
/**
 * @file error.tsx
 * @description Themed error boundary. Matches site styling.
 */

"use client";

import type React from "react";
import { useState } from "react";
import { FrostedSection, PageShell, CARD } from "@/shared/components/PageLayout";
import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/lib/cn";
import { FaArrowRotateRight, FaHouse } from "react-icons/fa6";

const MESSAGES = [
  "Something broke. Which is ironic, given that fixing broken things is literally my job.",
  "The website has done the digital equivalent of tripping over nothing.",
  "An error occurred. No, turning your screen off and on won't help. But it won't hurt either.",
  "Something went wrong - and unlike your printer, it's not out of paper.",
  "Well, this is embarrassing. The website is having a moment.",
  "The code gremlins struck again. I'll sort them out.",
  "This error is more unexpected than a Windows update at 8am.",
  "Something crashed. It happens to the best of us. Even me, occasionally.",
  "The website tried its best. Its best wasn't quite enough today.",
  "An error so unexpected, even the error message is confused.",
  "Something went sideways. Not sure how, but here we are.",
  "The website has encountered a problem and needs to restart. Sound familiar?",
];

/**
 * Error boundary UI for the App Router.
 * @param props - Component props.
 * @param props.error - Thrown error instance.
 * @param props.reset - Callback to re-render the segment.
 * @returns The error page element.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}): React.ReactElement {
  const msg = (error?.message || "").trim().slice(0, 300) || "An unexpected error occurred.";
  const [quip] = useState(() => MESSAGES[Math.floor(Math.random() * MESSAGES.length)]);

  return (
    <PageShell>
      <FrostedSection maxWidth="56rem">
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section className={cn(CARD, "text-center")}>
            <div className={cn("text-coquelicot-500 mb-4 text-7xl font-extrabold sm:text-8xl")}>
              Oops!
            </div>

            <h1
              className={cn(
                "text-russian-violet mb-4 text-3xl font-extrabold sm:text-4xl md:text-5xl",
              )}
            >
              The website has encountered an error
            </h1>

            <p className={cn("text-rich-black mb-6 text-base sm:text-lg md:text-xl")}>{quip}</p>

            <p
              className={cn("text-rich-black/70 wrap-break-word mb-6 text-sm italic sm:text-base")}
              role="status"
              aria-live="polite"
            >
              {msg}
            </p>

            <div className={cn("flex flex-wrap items-center justify-center gap-3")}>
              <Button type="button" onClick={reset} variant="primary">
                <FaArrowRotateRight className={cn("h-5 w-5")} aria-hidden />
                Try again
              </Button>
              <Button href="/" variant="ghost">
                <FaHouse className={cn("h-5 w-5")} aria-hidden />
                Go home
              </Button>
            </div>

            <details className={cn("text-rich-black/80 mt-6 text-base")}>
              <summary className={cn("hover:text-russian-violet cursor-pointer font-semibold")}>
                Technical details (for the curious)
              </summary>
              <pre
                className={cn(
                  "border-seasalt-400/60 bg-seasalt-900/60 mt-3 max-w-full overflow-auto rounded-lg border p-4 text-left text-base",
                )}
              >
                {String(error?.stack || error)}
              </pre>
            </details>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
