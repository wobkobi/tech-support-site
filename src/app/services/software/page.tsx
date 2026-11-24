// src/app/services/software/page.tsx
// Software page: previews the photo library app, locked until it launches. Noindex and left
// out of the sitemap until there's something to download.

import { Button } from "@/shared/components/Button";
import { PageHead } from "@/shared/components/PageHead";
import { PageShell } from "@/shared/components/PageLayout";
import { Section } from "@/shared/components/Section";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { pageOpenGraph } from "@/shared/lib/open-graph";
import type { Metadata } from "next";
import Image from "next/image";
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
export default async function SoftwarePage(): Promise<React.ReactElement> {
  const identity = await getIdentity();
  const earlyAccessMailto = `mailto:${identity.email}?subject=${encodeURIComponent(
    "Early access - photo library app",
  )}`;

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
            <span className="relative">
              <Image
                src="/software/photo-library-app.svg"
                alt="Photo library app icon"
                width={112}
                height={112}
                className="size-28"
              />
              <span className="absolute -right-1.5 -bottom-1.5 flex size-9 items-center justify-center rounded-full border-2 border-seasalt bg-russian-violet text-white">
                <FaLock aria-hidden className="size-3.5" />
              </span>
            </span>
            <p className="mt-5 text-sm font-bold tracking-[0.06em] text-moonstone-700 uppercase">
              Coming soon
            </p>
            <h2 id="software-app-heading" className="mt-2 text-2xl font-extrabold">
              Photo library app
            </h2>
            <p className="mt-3 text-seasalt-700">
              A Windows app that keeps your photo library tidy on its own. It sorts your photos and
              videos by the date they were taken, keeps holiday photos together, and brings in new
              ones from your phone or camera.
            </p>
            <p className="mt-3 text-seasalt-700">
              Everything stays on your PC, and any change it makes can be undone.
            </p>
          </div>

          <div className="mt-8 border-t border-seasalt-200 pt-6 text-center">
            <h3 className="text-xl font-extrabold">Want early access?</h3>
            <p className="mt-2">Get in touch and I'll let you try it before it's out.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Button href={earlyAccessMailto} variant="primary">
                Email me
              </Button>
              <Button href={identity.phoneTel} variant="outline">
                Call or text {identity.phone}
              </Button>
            </div>
          </div>
        </div>
      </Section>
    </PageShell>
  );
}
