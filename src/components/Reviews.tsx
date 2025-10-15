// src/components/Reviews.tsx
/**
 * Reviews module. Renders inside an existing frosted container.
 * less than 6 items: responsive rows centered using flex-wrap.
 * >6 items: marquee scroll.
 */

import { cn } from "@/lib/cn";

export interface ReviewItem {
  text: string;
  firstName?: string | null;
  lastName?: string | null;
  isAnonymous?: boolean | null;
}

export interface ReviewsProps {
  /** List of reviews to display. */
  items?: ReviewItem[];
}

/**
 * Build display name like "A. Bcdef." or "Anonymous".
 * Uses first/last unless r.isAnonymous is true.
 * @param r Review item to format.
 * @returns Formatted display name.
 */
function formatName(r: ReviewItem): string {
  if (r.isAnonymous) return "Anonymous";
  const f = (r.firstName ?? "").trim();
  const l = (r.lastName ?? "").trim();
  if (!f && !l) return "Anonymous";
  const initial = f ? `${f[0].toUpperCase()}. ` : "";
  const last = l ? `${l[0].toUpperCase()}${l.slice(1).toLowerCase()}` : "";
  const out = `${initial}${last}`.trim();
  return out ? `${out}.` : "Anonymous";
}

/**
 * Reviews section content. No outer frosted wrapper.
 * less than 6 items render as centered wrapped cards. >6 items use marquee.
 * @param root0 Component props.
 * @param [root0.items] Reviews to render.
 * @returns Section or null.
 */
export default function Reviews({ items = [] }: ReviewsProps): React.ReactElement | null {
  if (!items.length) return null;

  // Marquee when more than six reviews
  if (items.length > 6) {
    const track = [...items, ...items];
    return (
      <section aria-labelledby="reviews" className={cn("mx-auto w-full max-w-5xl")}>
        <h2
          id="reviews"
          className={cn("text-rich-black mb-2 text-center text-xl font-semibold sm:text-2xl")}
        >
          What People Say
        </h2>

        <div className={cn("relative w-full overflow-hidden rounded-lg bg-transparent p-0")}>
          <ul className={cn("marquee-track animate-marquee flex w-max gap-3")}>
            {track.map((r, i) => (
              <li
                key={`${formatName(r)}-${i}`}
                className={cn(
                  "border-seasalt-400/60 bg-seasalt-800/80 flex h-40 w-[360px] shrink-0 flex-col rounded-lg border p-4 sm:h-44 sm:w-[380px] sm:p-5",
                )}
              >
                <p className={cn("text-rich-black text-sm leading-relaxed sm:text-base")}>
                  {r.text}
                </p>
                <p
                  className={cn(
                    "text-russian-violet mt-auto pt-3 text-right text-xs font-semibold sm:text-sm",
                  )}
                >
                  - {formatName(r)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  // less than 6 items: center last row at all breakpoints using flex-wrap + justify-center
  return (
    <section aria-labelledby="reviews" className={cn("mx-auto w-full max-w-5xl")}>
      <h2
        id="reviews"
        className={cn("text-rich-black mb-2 text-center text-xl font-semibold sm:text-2xl")}
      >
        What People Say
      </h2>

      <ul
        className={cn(
          // rows
          "flex flex-wrap justify-center gap-3",
          // prevent odd spacing due to rounding
          "content-start",
        )}
      >
        {items.map((r, i) => (
          <li
            key={`${formatName(r)}-${i}`}
            className={cn(
              // width rules per breakpoint:
              // full width on mobile, two-up on sm, three-up on md+. Centering comes from justify-center.
              "w-full sm:w-[calc(50%-0.375rem)] md:w-[calc(33.333%-0.5rem)]",
              // card styles
              "border-seasalt-400/60 bg-seasalt-800 flex h-40 flex-col rounded-lg border p-4 shadow-sm sm:h-44 sm:p-5",
            )}
          >
            <p className={cn("text-rich-black text-sm sm:text-base")}>{r.text}</p>
            <p
              className={cn(
                "text-russian-violet mt-auto pt-3 text-right text-xs font-semibold sm:text-sm",
              )}
            >
              - {formatName(r)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
