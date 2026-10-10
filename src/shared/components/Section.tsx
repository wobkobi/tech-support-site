// src/shared/components/Section.tsx
// Full-width page section with the shared content container, and the eyebrow + h2 heading block.

import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Content width and side gutters shared by sections, the header, the footer and
 * the page head, so their edges line up down the page.
 */
export const CONTAINER = "mx-auto w-full max-w-[75rem] px-[1.125rem] sm:px-6";

/** Inline text link on white or seasalt: coquelicot-700 clears 4.5:1 at body size. */
export const TEXT_LINK =
  "font-bold text-coquelicot-700 underline underline-offset-4 hover:text-coquelicot-800";

export type SectionTone = "white" | "grey" | "violet" | "red";

const TONE_CLASSES: Record<SectionTone, string> = {
  white: "bg-white text-rich-black",
  grey: "bg-seasalt text-rich-black",
  violet: "bg-russian-violet text-white",
  red: "bg-coquelicot-600 text-white",
};

/** Props for {@link Section}. */
export interface SectionProps {
  /** Background band. Pages alternate white and grey, with at most one violet. */
  tone?: SectionTone;
  /** Anchor id; also adds scroll margin so the sticky header does not cover it. */
  id?: string;
  /** Extra classes on the full-width band. */
  className?: string;
  /** Extra classes on the inner container (grid or flex layouts). */
  containerClassName?: string;
  /** Id of the heading that names this section. */
  "aria-labelledby"?: string;
  /** Accessible name when the section has no visible heading. */
  "aria-label"?: string;
  /** Section content. */
  children: React.ReactNode;
}

/**
 * Full-width band with the shared container inside.
 * @param props - Component props.
 * @param props.tone - Background band colour.
 * @param props.id - Anchor id.
 * @param props.className - Extra classes on the band.
 * @param props.containerClassName - Extra classes on the container.
 * @param props.children - Section content.
 * @returns The section element.
 */
export function Section({
  tone = "white",
  id,
  className,
  containerClassName,
  children,
  ...aria
}: SectionProps): React.ReactElement {
  return (
    <section
      id={id}
      className={cn("py-11 sm:py-16", TONE_CLASSES[tone], id && "scroll-mt-28", className)}
      {...aria}
    >
      <div className={cn(CONTAINER, containerClassName)}>{children}</div>
    </section>
  );
}

/** Props for {@link SectionHeading}. */
export interface SectionHeadingProps {
  /** Small uppercase label above the heading. */
  eyebrow?: string;
  /** The h2 text. */
  title: React.ReactNode;
  /** Optional paragraph under the heading. */
  lead?: React.ReactNode;
  /** Id on the h2, for the section's aria-labelledby. */
  id?: string;
  /** Light text for violet and red bands. */
  onDark?: boolean;
  /** Extra classes on the wrapper (spacing overrides). */
  className?: string;
}

/**
 * Eyebrow, h2 and optional lead paragraph.
 * @param props - Component props.
 * @param props.eyebrow - Small uppercase label.
 * @param props.title - Heading text.
 * @param props.lead - Paragraph under the heading.
 * @param props.id - Id on the h2.
 * @param props.onDark - Light text for dark bands.
 * @param props.className - Extra wrapper classes.
 * @returns The heading block.
 */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  id,
  onDark = false,
  className,
}: SectionHeadingProps): React.ReactElement {
  return (
    <div className={cn("mb-8", className)}>
      {eyebrow && (
        <p
          className={cn(
            "mb-2 text-sm font-bold tracking-[0.06em] uppercase",
            onDark ? "text-moonstone-500" : "text-moonstone-700",
          )}
        >
          {eyebrow}
        </p>
      )}
      <h2
        id={id}
        className={cn(
          "text-[1.6875rem] leading-tight font-extrabold text-balance sm:text-[2.125rem]",
          onDark ? "text-white" : "text-rich-black",
        )}
      >
        {title}
      </h2>
      {lead && (
        <p
          className={cn(
            "mt-4 max-w-170 text-lg sm:text-[1.1875rem]",
            onDark ? "text-russian-violet-100" : "text-seasalt-700",
          )}
        >
          {lead}
        </p>
      )}
    </div>
  );
}
