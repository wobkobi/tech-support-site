// src/app/contact/loading.tsx

import { PageLoadingShell } from "@/shared/components/PageLoadingShell";
import type React from "react";

/**
 * Contact page route-loading spinner.
 * @returns Loading element.
 */
export default function ContactLoading(): React.ReactElement {
  return <PageLoadingShell label="contact page" />;
}
