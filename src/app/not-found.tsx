// src/app/not-found.tsx
/**
 * @file not-found.tsx
 * @description Themed 404 page. Matches site styling and offers a way home.
 */

import { FrostedSection, PageShell } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";
import Link from "next/link";
import { FaHouse } from "react-icons/fa6";

/**
 * 404 UI for missing routes.
 * @returns Not Found page element.
 */
export default function NotFound(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection>
        <section className={cn("mx-auto w-full max-w-5xl")}>
          <h1
            className={cn(
              "text-rich-black mb-3 text-center text-2xl font-bold sm:mb-4 sm:text-3xl md:text-4xl",
            )}
          >
            Page not found
          </h1>

          <div
            className={cn(
              "border-seasalt-400/60 bg-seasalt-800 rounded-lg border p-4 shadow-sm sm:p-6",
            )}
          >
            <p className={cn("text-rich-black mb-4 text-base font-medium sm:text-lg")}>
              The page you’re after isn’t here.
            </p>

            <Link
              href="/"
              className={cn(
                "text-russian-violet hover:text-coquelicot-500 inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold",
              )}
            >
              <FaHouse className={cn("h-4 w-4")} aria-hidden />
              Go home
            </Link>
          </div>
        </section>
      </FrostedSection>
    </PageShell>
  );
}
