// src/app/services/software/page.tsx
// Software page: previews the photo library app, locked until it launches. Noindex and left
// out of the sitemap until there's something to download.

import { PageHead } from "@/shared/components/PageHead";
import { PageShell } from "@/shared/components/PageLayout";
import { Section } from "@/shared/components/Section";
import { pageOpenGraph } from "@/shared/lib/open-graph";
import type { Metadata } from "next";
import type React from "react";
import { FaLock } from "react-icons/fa6";

const TITLE = "Software - Coming Soon";
const DESCRIPTION = "A Windows app that keeps your photo library tidy on its own. Coming soon.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/services/software" },
  openGraph: pageOpenGraph({ title: TITLE, description: DESCRIPTION, url: "/services/software" }),
  robots: { index: false, follow: true },
};

/**
 * Locked Software page.
 * @returns Software page element.
 */
export default function SoftwarePage(): React.ReactElement {
  return (
    <PageShell>
      <PageHead
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Services", path: "/services" },
          { name: "Software", path: "/services/software" },
        ]}
        title="Software"
        intro="Coming soon."
        action={null}
      />

      <Section aria-labelledby="software-app-heading">
        <div className="mx-auto max-w-xl border border-seasalt-200/80 bg-seasalt px-6 py-10 sm:px-10">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-russian-violet text-white">
              <FaLock aria-hidden className="size-7" />
            </span>
            <p className="mt-5 text-sm font-bold tracking-[0.06em] text-moonstone-700 uppercase">
              Coming soon
            </p>
            <h2 id="software-app-heading" className="mt-2 text-2xl font-extrabold">
              Photo library app
            </h2>
            <p className="mt-3 text-seasalt-700">
              A Windows app that keeps your photo library tidy on its own.
            </p>
          </div>
        </div>
      </Section>
    </PageShell>
  );
}
