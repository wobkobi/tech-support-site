// src/app/page.tsx
/**
 * Main landing with frosted hero, about and services, support grid, optional reviews, and footer.
 */

import type React from "react";
import Reviews, { type ReviewItem } from "@/components/Reviews";
import { FrostedSection, PageShell } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";
import { prisma } from "@/lib/prisma";
import Image from "next/image";
import Link from "next/link";
import {
  FaCloud,
  FaEnvelope,
  FaHouse,
  FaImages,
  FaLaptop,
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
export const revalidate = 0;

interface SupportItem {
  label: string;
  icon: IconType;
}

const supportItems: ReadonlyArray<SupportItem> = [
  { label: "Computers", icon: FaLaptop },
  { label: "Phones & Tablets", icon: FaMobileScreen },
  { label: "Wi-Fi & Internet", icon: FaWifi },
  { label: "TV & Streaming", icon: FaTv },
  { label: "Smart Home", icon: FaHouse },
  { label: "Printers & Scanners", icon: FaPrint },
  { label: "Cloud & Backups", icon: FaCloud },
  { label: "Email & Accounts", icon: FaEnvelope },
  { label: "Safety & Security", icon: FaShieldHalved },
  { label: "Setup & Transfer", icon: FaRightLeft },
  { label: "Tune-ups & Repairs", icon: FaToolbox },
  { label: "Photos & Storage", icon: FaImages },
];

const pageMain = cn(
  "mx-auto flex w-full max-w-7xl flex-col gap-4",
  "px-1.5 py-2 sm:gap-5 sm:px-2 sm:py-3",
);

const card = cn("border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-4 shadow-sm sm:p-5");
const softCard = cn(
  "border-seasalt-400/60 bg-seasalt-900/60 rounded-xl border p-3 text-sm sm:p-4 sm:text-base",
);

const primaryBtn = cn(
  "bg-coquelicot-500 hover:bg-coquelicot-600 text-rich-black rounded-md px-4 py-2 text-sm font-bold sm:text-base",
);

const secondaryBtn = cn(
  "border-seasalt-400/60 hover:bg-seasalt-900/40 text-rich-black rounded-md border px-4 py-2 text-sm font-bold sm:text-base",
);

/**
 * Home page component.
 * @returns The Home page React element.
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
        <div className={pageMain}>
          <section aria-labelledby="hero-heading" className={card}>
            <div
              className={cn(
                "grid items-start gap-4",
                "sm:grid-cols-[minmax(0,1.4fr),minmax(0,1fr)] sm:gap-6",
              )}
            >
              <div>
                <div className={cn("grid place-items-center pb-2 sm:place-items-start")}>
                  <Image
                    src="/logo-full.svg"
                    alt="To The Point Tech"
                    width={640}
                    height={146}
                    priority
                    draggable={false}
                    className={cn("h-auto w-[260px] sm:w-[320px] md:w-[460px] lg:w-[520px]")}
                  />
                </div>

                <h1
                  id="hero-heading"
                  className={cn("text-russian-violet mb-2 text-2xl font-bold sm:text-3xl")}
                >
                  Friendly tech help in Point Chevalier
                </h1>

                <p className={cn("text-rich-black text-sm font-medium sm:text-base md:text-lg")}>
                  Practical support for home and small business: setup, connectivity, storage,
                  safety, and more. Clear explanations, notes you can refer back to, and flexible
                  times.
                </p>

                <div className={cn("mt-3 flex flex-wrap gap-3")}>
                  <Link href="/contact" className={primaryBtn}>
                    Enquire now
                  </Link>
                  <Link href="/services" className={secondaryBtn}>
                    View services
                  </Link>
                </div>

                <p className={cn("text-rich-black/70 mt-2 text-xs sm:text-sm")}>
                  Serving Point Chevalier and nearby suburbs, with remote help available for many
                  tasks.
                </p>
              </div>

              <div className={softCard}>
                <h2 className={cn("text-russian-violet mb-2 text-sm font-semibold sm:text-base")}>
                  Common things I help with
                </h2>
                <ul
                  className={cn("text-rich-black/90 list-disc space-y-1 pl-5 text-xs sm:text-sm")}
                >
                  <li>New computer, phone, or tablet setup</li>
                  <li>Wi-Fi dropouts or slow internet</li>
                  <li>Backups and photo storage</li>
                  <li>Email and account issues</li>
                  <li>Smart TVs and streaming boxes</li>
                  <li>Smart home devices and apps</li>
                </ul>
              </div>
            </div>
          </section>

          <section
            aria-label="About and services overview"
            className={cn("grid gap-3 sm:grid-cols-2 sm:gap-4")}
          >
            <article
              className={cn(
                "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-4 shadow-sm sm:p-4",
              )}
            >
              <h2 className={cn("text-russian-violet mb-1 text-xl font-bold sm:text-2xl")}>
                About me
              </h2>
              <p className={cn("text-rich-black text-sm sm:text-base")}>
                Hi, I am Harrison, a computer science graduate from Point Chevalier. I grew up here,
                and I started To The Point Tech so locals have a reliable, friendly person to call
                when technology misbehaves.
              </p>
              <p className={cn("text-rich-black mt-2 text-sm sm:text-base")}>
                I focus on practical fixes, clear explanations, and leaving your setup in a better
                and easier-to-understand state than when I arrived.
              </p>
            </article>

            <article
              className={cn(
                "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-4 shadow-sm sm:p-4",
              )}
            >
              <h2 className={cn("text-russian-violet mb-1 text-xl font-bold sm:text-2xl")}>
                Services
              </h2>
              <p className={cn("text-rich-black mb-2 text-sm sm:text-base")}>
                I fix slow computers, set up new phones and laptops, sort Wi-Fi and network issues,
                connect printers and TVs, and make sure cloud backups and email run reliably. I can
                secure your devices, clean up unwanted software, and safely move photos and files
                between devices.
              </p>
              <p className={cn("text-rich-black text-sm sm:text-base")}>
                Everything is explained in plain language, with clear notes and no upselling.{" "}
                <Link
                  href="/services"
                  className={cn(
                    "text-coquelicot-500 hover:text-coquelicot-600 underline-offset-4 hover:underline",
                  )}
                >
                  See detailed services
                </Link>
                .
              </p>
            </article>
          </section>

          <section
            aria-labelledby="support"
            className={cn(
              "border-seasalt-400/60 bg-seasalt-800 w-full rounded-xl border p-4 shadow-sm sm:p-5",
            )}
          >
            <h2
              id="support"
              className={cn("text-rich-black mb-2 text-center text-xl font-semibold sm:text-2xl")}
            >
              Areas I can help with
            </h2>

            <ul
              className={cn(
                "max-w-272 mx-auto grid w-full grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4",
              )}
            >
              {supportItems.map(({ label, icon: Icon }) => (
                <li
                  key={label}
                  className={cn(
                    "border-seasalt-400/60 bg-seasalt-900/60 flex h-16 w-full min-w-0 items-center gap-3 rounded-xl border px-3",
                  )}
                >
                  <span
                    className={cn(
                      "border-moonstone-500/30 bg-moonstone-600/15 grid size-9 shrink-0 place-items-center rounded-md border sm:size-10",
                    )}
                  >
                    <Icon className={cn("text-moonstone-600 h-5 w-5 sm:h-6 sm:w-6")} aria-hidden />
                  </span>
                  <span
                    className={cn(
                      "text-rich-black line-clamp-2 min-w-0 text-left text-sm font-semibold leading-tight sm:text-base",
                    )}
                  >
                    {label}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </FrostedSection>

      {hasReviews && (
        <div className={cn("mt-4 sm:mt-6")}>
          <FrostedSection>
            <div className={cn("mx-auto w-full max-w-7xl px-1.5 py-2 sm:px-2 sm:py-3")}>
              <Reviews items={items} />
            </div>
          </FrostedSection>
        </div>
      )}

      <div aria-hidden className="grow" />

      <footer className={cn("mx-auto mt-4 w-fit max-w-[calc(100vw-1rem)] sm:mt-6")}>
        <div
          className={cn(
            "border-seasalt-400/40 bg-seasalt-800/70 flex flex-col items-center gap-3 rounded-xl border p-3 backdrop-blur-md sm:flex-row sm:items-center sm:gap-6 sm:px-4 sm:py-3",
          )}
        >
          <a
            href="tel:+64212971237"
            className={cn(
              "text-russian-violet hover:text-coquelicot-500 flex items-center gap-2 rounded-md px-3 py-2 text-base font-semibold sm:text-lg",
            )}
          >
            <FaPhone className={cn("h-6 w-6 shrink-0 sm:h-7 sm:w-7")} aria-hidden />
            <span>+64 21 297 1237</span>
          </a>

          <div className={cn("bg-seasalt-400/50 hidden h-5 w-px sm:block")} />

          <a
            href="mailto:harrison@tothepoint.co.nz"
            className={cn(
              "text-russian-violet hover:text-coquelicot-500 flex items-center gap-2 rounded-md px-3 py-2 text-base font-semibold sm:text-lg",
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
