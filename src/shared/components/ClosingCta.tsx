// src/shared/components/ClosingCta.tsx
// Coquelicot band at the foot of each marketing page: one heading, one line, Book and Call.

import { Button } from "@/shared/components/Button";
import { CONTAINER } from "@/shared/components/Section";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { FaPhone } from "react-icons/fa6";

/**
 * Closing call to action. Phone values come from identity settings, never a literal.
 * @param props - Component props.
 * @param props.title - The h2.
 * @param props.line - One line under the heading.
 * @param props.phone - Display phone number.
 * @param props.phoneTel - tel: URI for the Call button.
 * @returns The band element.
 */
export function ClosingCta({
  title,
  line,
  phone,
  phoneTel,
}: {
  title: string;
  line: string;
  phone: string;
  phoneTel: string;
}): React.ReactElement {
  return (
    <section aria-labelledby="closing-cta-heading" className="bg-coquelicot-600 py-12 text-white">
      <div className={cn(CONTAINER, "flex flex-wrap items-center justify-between gap-6")}>
        <div>
          <h2
            id="closing-cta-heading"
            className="mb-1 text-[1.6875rem] leading-tight font-extrabold sm:text-[1.875rem]"
          >
            {title}
          </h2>
          <p className="text-lg">{line}</p>
        </div>
        <div className="flex w-full flex-wrap gap-3 sm:w-auto">
          <Button href="/booking" variant="white" className="flex-1 sm:flex-none">
            Book appointment
          </Button>
          <Button href={phoneTel} variant="outline-white" className="flex-1 sm:flex-none">
            <FaPhone className="h-4 w-4" aria-hidden />
            {phone}
          </Button>
        </div>
      </div>
    </section>
  );
}
