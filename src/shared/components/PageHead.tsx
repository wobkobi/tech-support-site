// src/shared/components/PageHead.tsx
// Inner-page header band: breadcrumb, h1, intro and an action button. Also emits the page's
// BreadcrumbList JSON-LD, so the visible trail and the structured one stay identical.

import { BreadcrumbJsonLd, type BreadcrumbCrumb } from "@/shared/components/BreadcrumbJsonLd";
import { Button } from "@/shared/components/Button";
import { CONTAINER } from "@/shared/components/Section";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";

/** Props for {@link PageHead}. */
export interface PageHeadProps {
  /** Trail from Home to this page; the last crumb is the current page. */
  crumbs: ReadonlyArray<BreadcrumbCrumb>;
  /** The page's h1. */
  title: React.ReactNode;
  /** Paragraph under the h1. */
  intro?: React.ReactNode;
  /** Second, muted paragraph. */
  note?: React.ReactNode;
  /** Right-hand action. Omit for "Book now"; pass null for none. */
  action?: React.ReactNode | null;
}

/**
 * Grey page-head band used at the top of every inner page.
 * @param props - Component props.
 * @param props.crumbs - Breadcrumb trail, Home first.
 * @param props.title - The h1.
 * @param props.intro - Intro paragraph.
 * @param props.note - Muted second paragraph.
 * @param props.action - Action element, default Book now, null for none.
 * @returns The header band plus its JSON-LD script.
 */
export function PageHead({
  crumbs,
  title,
  intro,
  note,
  action,
}: PageHeadProps): React.ReactElement {
  return (
    <>
      <BreadcrumbJsonLd crumbs={crumbs} />
      <header className="border-b border-seasalt-100 bg-seasalt py-9 sm:pt-10 sm:pb-11">
        <div className={cn(CONTAINER, "flex flex-wrap items-end justify-between gap-6 sm:gap-8")}>
          <div className="max-w-180">
            <nav aria-label="Breadcrumb" className="mb-2.5 text-[0.9375rem] text-seasalt-700">
              <ol className="flex flex-wrap gap-x-1.5">
                {crumbs.map((c, i) => (
                  <li key={c.path} className="flex gap-x-1.5">
                    {i > 0 && <span aria-hidden="true">/</span>}
                    {i < crumbs.length - 1 ? (
                      <Link
                        href={c.path}
                        className="underline underline-offset-[3px] hover:text-coquelicot-700"
                      >
                        {c.name}
                      </Link>
                    ) : (
                      <span aria-current="page">{c.name}</span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
            <h1 className="text-[1.875rem] leading-tight font-extrabold text-rich-black sm:text-[2.5rem]">
              {title}
            </h1>
            {intro && <div className="mt-3 text-lg sm:text-[1.1875rem]">{intro}</div>}
            {note && <div className="mt-2 text-seasalt-700 sm:text-lg">{note}</div>}
          </div>
          {action === undefined ? (
            <Button href="/booking" variant="primary">
              Book now
            </Button>
          ) : (
            action
          )}
        </div>
      </header>
    </>
  );
}
