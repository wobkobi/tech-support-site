// src/app/contact/page.tsx
/**
 * Contact page: how to get in touch and what details to include.
 */

import type React from "react";
import { FrostedSection, PageShell } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";
import { FaEnvelope, FaPhone } from "react-icons/fa6";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ContactChannel {
  label: string;
  value: string;
  href: string;
  description: string;
  icon: React.ReactElement;
}

const pageMain = cn(
  "mx-auto flex w-full max-w-6xl flex-col gap-6 sm:gap-8",
  "pt-4 sm:pt-6 pb-6 sm:pb-8",
);

const card = cn("border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-4 shadow-sm sm:p-6");
const softCard = cn(
  "border-seasalt-400/60 bg-seasalt-900/60 rounded-xl border p-3 shadow-sm sm:p-4",
);
const primaryBtn = cn(
  "bg-coquelicot-500 hover:bg-coquelicot-600 text-rich-black flex items-center gap-2 rounded-md px-4 py-2 font-semibold",
);
const secondaryBtn = cn(
  "border-seasalt-400/60 hover:bg-seasalt-900/40 text-rich-black flex items-center gap-2 rounded-md border px-4 py-2 font-semibold",
);

/**
 * Contact page component.
 * @returns React element for the contact page.
 */
export default function ContactPage(): React.ReactElement {
  const channels: ReadonlyArray<ContactChannel> = [
    {
      label: "Phone",
      value: "+64 21 297 1237",
      href: "tel:+64212971237",
      description: "Best for time-sensitive issues or if you prefer to talk things through.",
      icon: <FaPhone className={cn("h-5 w-5")} aria-hidden />,
    },
    {
      label: "Email",
      value: "harrison@tothepoint.co.nz",
      href: "mailto:harrison@tothepoint.co.nz",
      description: "Great for sending a short description, photos, or a list of questions.",
      icon: <FaEnvelope className={cn("h-5 w-5")} aria-hidden />,
    },
  ];

  return (
    <PageShell>
      <FrostedSection>
        <main className={pageMain}>
          <section aria-labelledby="contact-hero-heading" className={card}>
            <h1
              id="contact-hero-heading"
              className={cn(
                "text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Contact
            </h1>

            <p className={cn("text-rich-black mb-3 max-w-3xl text-sm sm:text-base")}>
              Send a quick message or give me a call with what you need help with. I will let you
              know how I can help, an approximate time frame, and the next steps.
            </p>

            <p className={cn("text-rich-black/80 max-w-3xl text-sm sm:text-base")}>
              If I am with another client when you reach out, I will get back to you as soon as I
              can, usually the same day or the next business day.
            </p>
          </section>

          <section aria-labelledby="contact-options-heading" className={card}>
            <h2
              id="contact-options-heading"
              className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}
            >
              How to reach me
            </h2>

            <div
              className={cn(
                "grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.2fr),minmax(0,1fr)] sm:gap-4",
              )}
            >
              <div className={cn("flex flex-col gap-3")}>
                {channels.map((channel) => (
                  <a
                    key={channel.label}
                    href={channel.href}
                    className={cn(softCard, "hover:border-coquelicot-500/70 transition-colors")}
                  >
                    <div className={cn("flex items-start gap-3")}>
                      <span
                        className={cn(
                          "border-moonstone-500/30 bg-moonstone-600/15 grid size-9 shrink-0 place-items-center rounded-md border",
                        )}
                      >
                        <span className={cn("text-moonstone-600")}>{channel.icon}</span>
                      </span>

                      <div className={cn("min-w-0")}>
                        <span
                          className={cn("text-russian-violet text-xs font-semibold sm:text-sm")}
                        >
                          {channel.label}
                        </span>
                        <div className={cn("text-rich-black text-sm font-semibold sm:text-base")}>
                          {channel.value}
                        </div>
                        <div className={cn("text-rich-black/80 mt-1 text-xs sm:text-sm")}>
                          {channel.description}
                        </div>
                      </div>
                    </div>
                  </a>
                ))}
              </div>

              <div className={cn("flex flex-col justify-center gap-3 text-sm sm:text-base")}>
                <p className={cn("text-rich-black/80")}>
                  I am based in Point Chevalier and usually available on weekdays, with some
                  evenings by arrangement. If you prefer, you can start with an email and we can
                  move to a call later.
                </p>
                <p className={cn("text-rich-black/80")}>
                  If you are contacting me on behalf of a family member or small business, it helps
                  to mention that as well so I know who to address when we talk.
                </p>
              </div>
            </div>
          </section>

          <section aria-labelledby="contact-details-heading" className={card}>
            <h2
              id="contact-details-heading"
              className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}
            >
              What to include in your message
            </h2>

            <p className={cn("text-rich-black mb-3 max-w-3xl text-sm sm:text-base")}>
              You do not need to write an essay. A few key details are enough for me to understand
              the situation and suggest a plan.
            </p>

            <ul className={cn("text-rich-black/90 list-disc space-y-2 pl-5 text-sm sm:text-base")}>
              <li>A short description of the problem or what you would like to achieve.</li>
              <li>What devices are involved (for example, Windows laptop, iPad, smart TV).</li>
              <li>
                Whether it is for home or a small business, and roughly how many people are
                affected.
              </li>
              <li>
                Your general availability (for example, weekday mornings, evenings after 6 pm).
              </li>
              <li>
                Any deadlines or time-sensitive events (for example, "I need this before a trip next
                week").
              </li>
            </ul>

            <p className={cn("text-rich-black/80 mt-3 max-w-3xl text-sm sm:text-base")}>
              Photos and screenshots are welcome if they help explain an error or cable setup. You
              can attach those to an email if that is easier.
            </p>
          </section>

          <section aria-labelledby="contact-areas-heading" className={card}>
            <h2
              id="contact-areas-heading"
              className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}
            >
              Where I work
            </h2>

            <p className={cn("text-rich-black mb-2 max-w-3xl text-sm sm:text-base")}>
              I am based in Point Chevalier and mainly work across:
            </p>

            <ul
              className={cn(
                "text-rich-black/90 mb-3 list-disc space-y-1 pl-5 text-sm sm:text-base",
              )}
            >
              <li>Point Chevalier</li>
              <li>Western Springs</li>
              <li>Mount Albert</li>
              <li>Grey Lynn</li>
              <li>Westmere and nearby areas</li>
            </ul>

            <p className={cn("text-rich-black/80 max-w-3xl text-sm sm:text-base")}>
              Remote help is available for many software and account-related tasks, as long as you
              have a reasonable internet connection. If you are unsure whether your job needs an
              on-site visit, just mention that when you get in touch and I can advise.
            </p>

            <div className={cn("mt-4 flex flex-wrap items-center gap-3 text-sm sm:text-base")}>
              <a href="tel:+64212971237" className={primaryBtn}>
                <FaPhone className={cn("h-5 w-5")} aria-hidden />
                Call +64 21 297 1237
              </a>
              <a href="mailto:harrison@tothepoint.co.nz" className={secondaryBtn}>
                <FaEnvelope className={cn("h-5 w-5")} aria-hidden />
                Email harrison@tothepoint.co.nz
              </a>
            </div>
          </section>
        </main>
      </FrostedSection>
    </PageShell>
  );
}
