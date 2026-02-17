// src/app/page.tsx
/**
 * @file page.tsx
 * @description Main landing page for tech support company
 */

import type React from "react";
import Reviews, { type ReviewItem } from "@/components/Reviews";
import { FrostedSection, PageShell } from "@/components/PageLayout";
import { cn } from "@/lib/cn";
import { prisma } from "@/lib/prisma";
import Image from "next/image";
import Link from "next/link";
import {
  FaCalendarCheck,
  FaCircleCheck,
  FaCloud,
  FaEnvelope,
  FaHandshake,
  FaHouse,
  FaImages,
  FaLaptop,
  FaMapLocationDot,
  FaMobileScreen,
  FaPhone,
  FaPrint,
  FaRightLeft,
  FaShieldHalved,
  FaToolbox,
  FaTv,
  FaWifi,
} from "react-icons/fa6";
import type { IconType } from "react-icons";

export const dynamic = "force-dynamic";
export const revalidate = 300; // Cache for 5 minutes - reviews don't change frequently

interface SupportItem {
  label: string;
  icon: IconType;
}

const supportItems: ReadonlyArray<SupportItem> = [
  { label: "Computers & Laptops", icon: FaLaptop },
  { label: "Phones & Tablets", icon: FaMobileScreen },
  { label: "Wi-Fi & Networks", icon: FaWifi },
  { label: "Smart TVs", icon: FaTv },
  { label: "Smart Home", icon: FaHouse },
  { label: "Printers", icon: FaPrint },
  { label: "Cloud & Backups", icon: FaCloud },
  { label: "Email Setup", icon: FaEnvelope },
  { label: "Security", icon: FaShieldHalved },
  { label: "Data Transfer", icon: FaRightLeft },
  { label: "Repairs", icon: FaToolbox },
  { label: "Photo Storage", icon: FaImages },
];

const CARD = cn(
  "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-5 shadow-sm sm:p-6 md:p-7",
);

const primaryBtn = cn(
  "bg-coquelicot-500 hover:bg-coquelicot-600 text-seasalt inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-bold sm:text-base transition-colors",
);

/**
 * Home page component
 * @returns The Home page React element
 */
export default async function Home(): Promise<React.ReactElement> {
  const rows = await prisma.review.findMany({
    orderBy: { createdAt: "desc" },
    select: { text: true, firstName: true, lastName: true, isAnonymous: true },
    where: { approved: true },
    take: 20,
  });

  const items: ReviewItem[] = rows.map((r) => ({
    text: r.text,
    firstName: r.firstName,
    lastName: r.lastName,
    isAnonymous: r.isAnonymous,
  }));

  const hasReviews = items.length > 0;

  return (
    <PageShell>
      <FrostedSection>
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          {/* Hero Section */}
          <section aria-labelledby="hero-heading" className={cn("text-center animate-fade-in")}>
            <div className={cn("mb-6 grid place-items-center")}>
              <Image
                src="/source/logo-full.svg"
                alt="To The Point Tech"
                width={640}
                height={146}
                priority
                draggable={false}
                className={cn("w-70 sm:w-95 md:w-120 lg:w-140 h-auto")}
              />
            </div>

            <p
              className={cn(
                "text-rich-black mx-auto mb-8 max-w-3xl text-lg font-medium sm:text-xl md:text-2xl",
              )}
            >
              Professional tech help in Point Chevalier and nearby suburbs. Clear explanations, no
              jargon, and solutions that actually work.
            </p>

            <div className={cn("flex flex-wrap items-center justify-center gap-4")}>
              <Link href="/booking" className={primaryBtn}>
                <FaCalendarCheck className={cn("h-5 w-5")} aria-hidden />
                Book appointment
              </Link>
              <a
                href="tel:+64212971237"
                className={cn(
                  "bg-russian-violet text-seasalt inline-flex items-center gap-2 rounded-lg px-5 py-3 text-base font-bold sm:text-lg transition-colors hover:brightness-110",
                )}
              >
                <FaPhone className={cn("h-5 w-5")} aria-hidden />
                <span>021 297 1237</span>
              </a>
            </div>

            <p className={cn("text-rich-black/70 mt-6 text-base sm:text-lg")}>
              Same day appointments available • Evening & weekend hours • Remote support options
            </p>
          </section>

          {/* Trust Indicators */}
          <section aria-label="Why choose us" className={cn("grid gap-4 sm:grid-cols-3 sm:gap-5")}>
            <div className={cn(CARD, "text-center animate-slide-up animate-fill-both animate-delay-100")}>
              <div
                className={cn(
                  "bg-moonstone-500/10 border-moonstone-500/30 mx-auto mb-3 grid size-16 place-items-center rounded-full border-2",
                )}
              >
                <FaCircleCheck className={cn("text-moonstone-600 h-8 w-8")} aria-hidden />
              </div>
              <h3 className={cn("text-russian-violet mb-2 text-xl font-bold sm:text-2xl")}>
                CS Graduate
              </h3>
              <p className={cn("text-rich-black/80 text-base sm:text-lg")}>
                University-trained with real-world experience
              </p>
            </div>

            <div className={cn(CARD, "text-center animate-slide-up animate-fill-both animate-delay-200")}>
              <div
                className={cn(
                  "bg-moonstone-500/10 border-moonstone-500/30 mx-auto mb-3 grid size-16 place-items-center rounded-full border-2",
                )}
              >
                <FaMapLocationDot className={cn("text-moonstone-600 h-8 w-8")} aria-hidden />
              </div>
              <h3 className={cn("text-russian-violet mb-2 text-xl font-bold sm:text-2xl")}>
                Point Chev Local
              </h3>
              <p className={cn("text-rich-black/80 text-base sm:text-lg")}>
                Born and raised here, serving the community
              </p>
            </div>

            <div className={cn(CARD, "text-center animate-slide-up animate-fill-both animate-delay-300")}>
              <div
                className={cn(
                  "bg-moonstone-500/10 border-moonstone-500/30 mx-auto mb-3 grid size-16 place-items-center rounded-full border-2",
                )}
              >
                <FaHandshake className={cn("text-moonstone-600 h-8 w-8")} aria-hidden />
              </div>
              <h3 className={cn("text-russian-violet mb-2 text-xl font-bold sm:text-2xl")}>
                No Upselling
              </h3>
              <p className={cn("text-rich-black/80 text-base sm:text-lg")}>
                Honest advice, fair pricing, clear communication
              </p>
            </div>
          </section>

          {/* Services Grid */}
          <section aria-labelledby="services-heading" className={cn("text-center animate-slide-up animate-fill-both animate-delay-200")}>
            <h2
              id="services-heading"
              className={cn(
                "text-rich-black mb-8 text-3xl font-bold sm:text-4xl md:text-5xl",
              )}
            >
              What I can help with
            </h2>

            <ul
              className={cn(
                "mx-auto grid max-w-6xl grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:gap-5",
              )}
            >
              {supportItems.map(({ label, icon: Icon }) => (
                <li
                  key={label}
                  className={cn(
                    "border-seasalt-400/60 bg-seasalt-800 flex h-24 items-center gap-3 rounded-xl border px-4 shadow-sm transition-all hover:shadow-md sm:h-28",
                  )}
                >
                  <span
                    className={cn(
                      "border-moonstone-500/40 bg-moonstone-600/20 grid size-12 shrink-0 place-items-center rounded-lg border sm:size-14",
                    )}
                  >
                    <Icon className={cn("text-moonstone-600 h-6 w-6 sm:h-7 sm:w-7")} aria-hidden />
                  </span>
                  <span
                    className={cn(
                      "text-rich-black line-clamp-2 text-left text-base font-semibold leading-tight sm:text-lg",
                    )}
                  >
                    {label}
                  </span>
                </li>
              ))}
            </ul>

            <div className={cn("mt-8 text-center")}>
              <Link
                href="/services"
                className={cn(
                  "bg-moonstone-600 hover:bg-moonstone-700 text-seasalt inline-flex items-center gap-2 rounded-lg px-6 py-3 text-base font-bold sm:text-lg transition-all shadow-md hover:shadow-lg",
                )}
              >
                View all services
              </Link>
            </div>
          </section>

          {/* About & Approach */}
          <section
            aria-label="About and approach"
            className={cn("grid gap-5 md:grid-cols-2 md:gap-6")}
          >
            <article className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-300")}>
              <h2 className={cn("text-russian-violet mb-4 text-2xl font-bold sm:text-3xl")}>
                About Me
              </h2>
              <p className={cn("text-rich-black mb-4 text-base sm:text-lg")}>
                Hi, I'm Harrison, a computer science graduate from Point Chevalier. I started To The
                Point Tech to give locals a reliable, friendly person to call when technology acts
                up.
              </p>
              <p className={cn("text-rich-black/90 text-base sm:text-lg")}>
                I focus on practical fixes and clear explanations, leaving your tech in a better
                state than when I arrived.
              </p>
            </article>

            <article className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-400")}>
              <h2 className={cn("text-russian-violet mb-4 text-2xl font-bold sm:text-3xl")}>
                My approach
              </h2>
              <ul className={cn("text-rich-black space-y-3 text-base sm:text-lg")}>
                <li className={cn("flex gap-3")}>
                  <FaCircleCheck
                    className={cn("text-moonstone-600 mt-1 h-5 w-5 shrink-0")}
                    aria-hidden
                  />
                  <span>Listen first, understand your needs</span>
                </li>
                <li className={cn("flex gap-3")}>
                  <FaCircleCheck
                    className={cn("text-moonstone-600 mt-1 h-5 w-5 shrink-0")}
                    aria-hidden
                  />
                  <span>Explain everything in plain English</span>
                </li>
                <li className={cn("flex gap-3")}>
                  <FaCircleCheck
                    className={cn("text-moonstone-600 mt-1 h-5 w-5 shrink-0")}
                    aria-hidden
                  />
                  <span>Leave clear notes you can refer back to</span>
                </li>
                <li className={cn("flex gap-3")}>
                  <FaCircleCheck
                    className={cn("text-moonstone-600 mt-1 h-5 w-5 shrink-0")}
                    aria-hidden
                  />
                  <span>Transparent pricing, no hidden fees</span>
                </li>
              </ul>
            </article>
          </section>
        </div>
      </FrostedSection>

      {/* Reviews Section */}
      {hasReviews && (
        <div className={cn("pb-6 sm:pb-8 animate-fade-in animate-delay-500 animate-fill-both")}>
          <FrostedSection>
            <Reviews items={items} />
          </FrostedSection>
        </div>
      )}

      {/* Contact Footer */}
      <footer className={cn("mx-auto mb-6 w-fit max-w-[calc(100vw-2rem)] sm:mb-8")}>
        <div
          className={cn(
            "border-seasalt-400/40 bg-seasalt-800/70 flex flex-col items-center gap-4 rounded-xl border p-4 shadow-lg backdrop-blur-md sm:flex-row sm:gap-8 sm:px-6 sm:py-4",
          )}
        >
          <a
            href="tel:+64212971237"
            className={cn(
              "text-russian-violet hover:text-coquelicot-500 flex items-center gap-3 rounded-md px-4 py-2 text-base font-semibold transition-colors sm:text-lg",
            )}
          >
            <FaPhone className={cn("h-6 w-6 shrink-0 sm:h-7 sm:w-7")} aria-hidden />
            <span>021 297 1237</span>
          </a>

          <div className={cn("bg-seasalt-400/50 hidden h-6 w-px sm:block")} />

          <a
            href="mailto:harrison@tothepoint.co.nz"
            className={cn(
              "text-russian-violet hover:text-coquelicot-500 flex items-center gap-3 rounded-md px-4 py-2 text-base font-semibold transition-colors sm:text-lg",
            )}
          >
            <FaEnvelope className={cn("h-6 w-6 shrink-0 sm:h-7 sm:w-7")} aria-hidden />
            <span>harrison@tothepoint.co.nz</span>
          </a>
        </div>
      </footer>
    </PageShell>
  );
}
