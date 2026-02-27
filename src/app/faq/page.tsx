// src/app/faq/page.tsx
/**
 * @file page.tsx
 * @description FAQ page: common questions about services, pricing, and how I work.
 */

import type React from "react";
import Link from "next/link";
import { FrostedSection, PageShell, CARD, SOFT_CARD } from "@/components/PageLayout";
import { cn } from "@/lib/cn";

interface FaqItem {
  question: string;
  answer: React.ReactNode;
}

const linkStyle = cn(
  "text-coquelicot-500 hover:text-coquelicot-600 underline-offset-4 hover:underline",
);

const faqItems: ReadonlyArray<FaqItem> = [
  {
    question: "Where are you based and what areas do you cover?",
    answer: (
      <>
        <p>
          I'm based in Point Chevalier and mainly work across Point Chev, Western Springs, Mount
          Albert, Grey Lynn, Westmere, Kingsland, and nearby suburbs.
        </p>
        <p className={cn("text-rich-black/80 mt-2")}>
          Not sure if you're in range? Send a message and I'll let you know.
        </p>
      </>
    ),
  },
  {
    question: "Do you offer remote support?",
    answer: (
      <>
        <p>
          Yes. Many software, account, and setup issues can be handled remotely if you are
          comfortable with it.
        </p>
        <p className={cn("text-rich-black/80 mt-2")}>
          If it turns out an on-site visit is needed (for Wi-Fi hardware, printers, cabling, etc.),
          we can switch.
        </p>
      </>
    ),
  },
  {
    question: "What devices and systems do you work with?",
    answer: (
      <>
        <p>
          I'm a jack of all trades when it comes to devices. Windows, Mac, Android, iOS, printers,
          smart TVs, networking gear - I've worked with most common tech and can quickly pick up
          anything new.
        </p>
        <p className={cn("text-rich-black/80 mt-2")}>
          If you have something unusual or specialized, just mention the model and I'll let you know
          if I can help or point you in the right direction.
        </p>
      </>
    ),
  },
  {
    question: "How much does it cost?",
    answer: (
      <>
        <p>
          I charge $50 per hour, but it depends on the complexity of the task. I'll give you a clear
          estimate before starting so there are no surprises.
        </p>
        <p className={cn("text-rich-black/80 mt-2")}>
          See the{" "}
          <Link href="/pricing" className={linkStyle}>
            pricing page
          </Link>{" "}
          for more details, or{" "}
          <Link href="/contact" className={linkStyle}>
            get in touch
          </Link>{" "}
          for a quote.
        </p>
      </>
    ),
  },
  {
    question: "Do you sell hardware or push unnecessary upgrades?",
    answer: (
      <>
        <p>
          No. I don't sell products or earn commission on anything. My goal is to fix the problem
          and leave you with a setup you understand.
        </p>
        <p className={cn("text-rich-black/80 mt-2")}>
          If a replacement part or upgrade genuinely makes sense, I'll explain the options and you
          decide.
        </p>
      </>
    ),
  },
  {
    question: "How do I book an appointment?",
    answer: (
      <>
        <p>
          You can{" "}
          <Link href="/booking" className={linkStyle}>
            book online
          </Link>{" "}
          for available times, or{" "}
          <Link href="/contact" className={linkStyle}>
            contact me
          </Link>{" "}
          directly by phone or email.
        </p>
        <p className={cn("text-rich-black/80 mt-2")}>
          For urgent issues, calling is best so I can try to fit you in sooner.
        </p>
      </>
    ),
  },
  {
    question: "What if you can't fix the problem?",
    answer: (
      <>
        <p>
          If I can't resolve your issue, on-site visits are half price. Remote support is usually
          free, though I may charge for extended troubleshooting.
        </p>
      </>
    ),
  },
];

/**
 * FAQ page component.
 * @returns FAQ page element.
 */
export default function FaqPage(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection maxWidth="56rem">
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section aria-labelledby="faq-heading" className={cn(CARD, "animate-fade-in")}>
            <h1
              id="faq-heading"
              className={cn(
                "text-russian-violet mb-4 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Frequently asked questions
            </h1>
            <p className={cn("text-rich-black/80 text-base sm:text-lg")}>
              Quick answers to common questions. Don't see yours?{" "}
              <Link href="/contact" className={linkStyle}>
                Get in touch
              </Link>
              .
            </p>
          </section>

          <section
            aria-label="FAQ list"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}
          >
            <div className={cn("space-y-4")}>
              {faqItems.map((item) => (
                <details key={item.question} className={cn(SOFT_CARD, "group")}>
                  <summary
                    className={cn(
                      "text-rich-black flex cursor-pointer select-text items-center justify-between gap-3 text-sm font-semibold sm:text-base",
                      "list-none [&::-webkit-details-marker]:hidden",
                    )}
                  >
                    <span>{item.question}</span>
                    <span
                      className={cn(
                        "text-moonstone-600 shrink-0 text-lg transition-transform duration-200 group-open:rotate-180",
                      )}
                      aria-hidden
                    >
                      ▾
                    </span>
                  </summary>
                  <div className={cn("text-rich-black/90 mt-3 text-sm sm:text-base")}>
                    {item.answer}
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section
            aria-label="Next steps"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-200")}
          >
            <p className={cn("text-rich-black text-base sm:text-lg")}>
              Ready to get started?{" "}
              <Link href="/booking" className={linkStyle}>
                Book online
              </Link>{" "}
              or{" "}
              <Link href="/contact" className={linkStyle}>
                contact me
              </Link>{" "}
              to discuss your needs.
            </p>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
