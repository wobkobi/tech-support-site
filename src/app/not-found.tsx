// src/app/not-found.tsx
/**
 * @file not-found.tsx
 * @description Themed 404 page. Matches site styling.
 */

"use client";

import type React from "react";
import { useState } from "react";
import { FrostedSection, PageShell, CARD } from "@/shared/components/PageLayout";
import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/lib/cn";
import { FaHouse } from "react-icons/fa6";

const MESSAGES = [
  "This page seems to have wandered off like a Wi-Fi signal at the worst possible moment.",
  "Looks like this page went offline. Have you tried turning it off and on again?",
  "This page is buffering… indefinitely.",
  "Page not found. It's probably hiding in the same place as your TV remote.",
  "This page crashed harder than a Windows update at the worst time.",
  "Last seen heading toward the recycle bin.",
  "This page has gone the way of Internet Explorer - fondly remembered by no one.",
  "Like Bluetooth headphones at 2%, this page has quietly given up.",
  "This URL is about as useful as a printer at 3am.",
  "This page has as many bars as your phone in the kitchen.",
  "Even Google can't find this one. And they find everything.",
  "This page went to get milk and never came back.",
];

/**
 * 404 UI for missing routes.
 * @returns Not Found page element.
 */
export default function NotFound(): React.ReactElement {
  const [message] = useState(() => MESSAGES[Math.floor(Math.random() * MESSAGES.length)]);

  return (
    <PageShell>
      <FrostedSection maxWidth="56rem">
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section className={cn(CARD, "text-center")}>
            <div className={cn("text-coquelicot-500 mb-4 text-8xl font-extrabold sm:text-9xl")}>
              404
            </div>

            <h1
              className={cn(
                "text-russian-violet mb-4 text-3xl font-extrabold sm:text-4xl md:text-5xl",
              )}
            >
              Well, this is awkward...
            </h1>

            <p className={cn("text-rich-black mb-6 text-base sm:text-lg md:text-xl")}>{message}</p>

            <div className={cn("flex flex-wrap items-center justify-center gap-3")}>
              <Button href="/" variant="primary">
                <FaHouse className={cn("h-5 w-5")} aria-hidden />
                Take me home
              </Button>
              <Button href="/contact" variant="ghost">
                Report this issue
              </Button>
            </div>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
