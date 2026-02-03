// src/app/faq/page.tsx
/**
 * FAQ page.
 */

import type React from "react";
import Link from "next/link";
import { FrostedSection, PageShell } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface FaqItem {
  question: string;
  answer: React.ReactNode;
}

const pageMain = cn(
  "mx-auto flex w-full max-w-6xl flex-col gap-6 sm:gap-8",
  "pt-4 sm:pt-6 pb-6 sm:pb-8",
);

const card = cn("border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-4 shadow-sm sm:p-6");
const softCard = cn(
  "border-seasalt-400/60 bg-seasalt-900/60 rounded-xl border p-3 shadow-sm sm:p-4",
);
const linkStyle = cn(
  "text-coquelicot-500 hover:text-coquelicot-600 underline-offset-4 hover:underline",
);

const faqItems: ReadonlyArray<FaqItem> = [
  {
    question: "Where are you based and what areas do you cover?",
    answer: (
      <div className={cn("space-y-2")}>
        <p>I am based in Point Chevalier. Most on-site visits are around the local area.</p>
        <p className={cn("text-rich-black/80")}>
          If you are nearby but not sure, send a message and I will let you know what works.
        </p>
      </div>
    ),
  },
  {
    question: "Do you offer remote support?",
    answer: (
      <div className={cn("space-y-2")}>
        <p>
          Yes, for many software, account, and setup jobs where you have a stable internet
          connection.
        </p>
        <p className={cn("text-rich-black/80")}>
          If it turns out an on-site visit is needed (for cabling, Wi-Fi hardware, printers, etc.),
          we can switch.
        </p>
      </div>
    ),
  },
  {
    question: "What kinds of devices do you work with?",
    answer: (
      <div className={cn("space-y-2")}>
        <p>
          Windows PCs and laptops, phones and tablets, Wi-Fi and networking gear, printers, smart
          TVs, and common home tech.
        </p>
        <p className={cn("text-rich-black/80")}>
          If you have something unusual, include the model in your message and I will confirm.
        </p>
      </div>
    ),
  },
  {
    question: "Do you sell hardware or upsell products?",
    answer: (
      <div className={cn("space-y-2")}>
        <p>
          No upselling. The focus is fixing the problem and leaving you with a setup you understand.
        </p>
        <p className={cn("text-rich-black/80")}>
          If a replacement part or upgrade genuinely makes sense, I will explain options and you
          decide.
        </p>
      </div>
    ),
  },
  {
    question: "How do bookings work?",
    answer: (
      <div className={cn("space-y-2")}>
        <p>You can message or email first, or use online booking for available times.</p>
        <p className={cn("text-rich-black/80")}>
          For urgent issues, calling is best so I can try to fit you in sooner.
        </p>
      </div>
    ),
  },
];

/**
 *
 */
export default function FaqPage(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection>
        <main className={pageMain}>
          <section aria-labelledby="faq-heading" className={card}>
            <h1
              id="faq-heading"
              className={cn(
                "text-russian-violet mb-2 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              FAQ
            </h1>
            <p className={cn("text-rich-black/80 max-w-3xl text-sm sm:text-base")}>
              Quick answers to common questions. If you do not see your question here,{" "}
              <Link href="/contact" className={linkStyle}>
                contact me
              </Link>
              .
            </p>
          </section>

          <section aria-label="Frequently asked questions" className={card}>
            <div className={cn("space-y-3")}>
              {faqItems.map((item) => (
                <details key={item.question} className={softCard}>
                  <summary
                    className={cn(
                      "text-rich-black cursor-pointer select-text text-sm font-semibold sm:text-base",
                    )}
                  >
                    {item.question}
                  </summary>
                  <div className={cn("text-rich-black/90 mt-2 text-sm sm:text-base")}>
                    {item.answer}
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section aria-label="Next steps" className={card}>
            <p className={cn("text-rich-black text-sm sm:text-base")}>
              Next:{" "}
              <Link href="/services" className={linkStyle}>
                view services
              </Link>{" "}
              or{" "}
              <Link href="/booking" className={linkStyle}>
                book a time
              </Link>
              .
            </p>
          </section>
        </main>
      </FrostedSection>
    </PageShell>
  );
}
