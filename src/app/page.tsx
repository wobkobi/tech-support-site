// src/app/page.tsx
/**
 * Main landing with frosted hero, about and services, support grid, optional reviews, and sticky footer.
 */

import Reviews, { type ReviewItem } from "@/components/Reviews";
import { FrostedSection, PageShell } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";
import { prisma } from "@/lib/prisma";
import Image from "next/image";
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

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supportItems = [
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

/**
 * Home page component
 * @returns The Home page React element.
 */
export default async function Home(): Promise<React.ReactElement> {
  // Build-safe select. Add firstName/lastName/isAnonymous here after you migrate the schema.
  const rows = await prisma.review.findMany({
    orderBy: { createdAt: "desc" },
    select: { text: true, firstName: true, lastName: true, isAnonymous: true },
    where: { approved: true },
    take: 20,
  });

  const items: ReviewItem[] = rows as unknown as ReviewItem[];
  const hasReviews = items.length > 0;

  return (
    <PageShell>
      <FrostedSection>
        {/* Logo */}
        <div className={cn("grid place-items-center pb-4 sm:pb-6")}>
          <Image
            src="/logo-full.svg"
            alt="To The Point Tech"
            width={640}
            height={146}
            priority
            draggable={false}
            className={cn(
              "h-auto w-[300px] select-none sm:w-[340px] md:w-[500px] lg:w-[620px]"
            )}
          />
        </div>

        {/* Text boxes */}
        <section
          className={cn(
            "mx-auto flex w-full max-w-5xl flex-col gap-3 sm:gap-4"
          )}>
          <div
            className={cn(
              "border-seasalt-400/60 bg-seasalt-800 rounded-lg border p-4 shadow-sm sm:p-4"
            )}>
            <h2 className={cn("text-russian-violet mb-1 text-2xl font-bold")}>
              About Me
            </h2>
            <p
              className={cn(
                "text-rich-black text-base font-medium sm:text-lg"
              )}>
              Hi there, I'm Harrison. I'm a computer science graduate from Point
              Chevalier, eager to apply my practical tech skills to benefit the
              community. I grew up here and want to make technology more
              straightforward and less stressful for people who don't have a
              go-to tech person.
            </p>
          </div>

          <div
            className={cn(
              "border-seasalt-400/60 bg-seasalt-800 rounded-lg border p-4 shadow-sm sm:p-4"
            )}>
            <h2
              className={cn(
                "text-russian-violet mb-1 text-2xl font-bold sm:mb-2"
              )}>
              Services
            </h2>
            <p
              className={cn(
                "text-rich-black mb-2 text-base font-medium sm:mb-3 sm:text-lg"
              )}>
              If you've got a tech issue, I can help. I fix slow computers, set
              up new phones and laptops, sort Wi-Fi and network connections,
              connect printers and TVs, and make sure cloud backups and email
              run reliably. I secure devices, remove scams and malware, and move
              photos and files safely. I explain in plain language, leave clear
              notes, and don't upsell.
            </p>
            <p
              className={cn(
                "text-rich-black text-base font-medium sm:text-lg"
              )}>
              Please message or email me to say what's going on, and we'll book
              a time that suits you.
            </p>
          </div>
        </section>

        {/* Support grid */}
        <section
          aria-labelledby="support"
          className={cn("mx-auto mt-4 w-full max-w-5xl sm:mt-6")}>
          <h2
            id="support"
            className={cn(
              "text-rich-black mb-2 text-center text-xl font-semibold sm:text-2xl"
            )}>
            Areas I Can Help With
          </h2>
          <ul
            className={cn(
              "mx-auto grid w-full max-w-[68rem] grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4"
            )}>
            {supportItems.map(({ label, icon: Icon }) => (
              <li
                key={label}
                className={cn(
                  "border-seasalt-400/60 bg-seasalt-800 flex h-16 w-full min-w-0 items-center gap-3 rounded-lg border px-3"
                )}>
                <span
                  className={cn(
                    "border-moonstone-500/30 bg-moonstone-600/15 grid size-9 shrink-0 place-items-center rounded-md border sm:size-10"
                  )}>
                  <Icon
                    className={cn("text-moonstone-600 h-5 w-5 sm:h-6 sm:w-6")}
                    aria-hidden
                  />
                </span>
                <span
                  className={cn(
                    "text-rich-black line-clamp-2 min-w-0 text-left text-sm leading-tight font-semibold [overflow-wrap:anywhere] sm:text-base md:text-[17px]"
                  )}>
                  {label}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </FrostedSection>

      {/* Reviews only when present */}
      {hasReviews && (
        <div className="mt-4 sm:mt-6">
          <FrostedSection>
            <Reviews items={items} />
          </FrostedSection>
        </div>
      )}

      {/* Fixed gap above footer regardless of reviews presence */}
      <div aria-hidden className="grow" />

      {/* Sticky footer */}
      <footer
        className={cn("mx-auto mt-4 w-fit max-w-[calc(100vw-2rem)] sm:mt-6")}>
        <div
          className={cn(
            "border-seasalt-400/40 bg-seasalt-800/70 flex flex-col items-stretch gap-3 rounded-lg border p-3 backdrop-blur-md sm:flex-row sm:items-center sm:gap-6 sm:px-4 sm:py-3"
          )}>
          <a
            href="tel:+64212971237"
            className={cn(
              "text-russian-violet hover:text-coquelicot-500 flex items-center gap-2 rounded-md px-3 py-2 text-base font-semibold sm:text-lg"
            )}>
            <FaPhone
              className={cn("h-6 w-6 shrink-0 select-none sm:h-7 sm:w-7")}
              aria-hidden
            />
            <span>+64 21 297 1237</span>
          </a>
          <div className={cn("bg-seasalt-400/50 hidden h-5 w-px sm:block")} />
          <a
            href="mailto:harrisonraynes8@gmail.com"
            className={cn(
              "text-russian-violet hover:text-coquelicot-500 flex items-center gap-2 rounded-md px-3 py-2 text-base font-semibold sm:text-lg"
            )}>
            <FaEnvelope
              className={cn("h-6 w-6 shrink-0 select-none sm:h-7 sm:w-7")}
              aria-hidden
            />
            <span>harrisonraynes8@gmail.com</span>
          </a>
        </div>
      </footer>
    </PageShell>
  );
}
