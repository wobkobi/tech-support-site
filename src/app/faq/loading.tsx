// src/app/faq/loading.tsx

import { PageLoadingShell } from "@/shared/components/PageLoadingShell";
import type React from "react";

/**
 * FAQ page route-loading spinner.
 * @returns Loading element.
 */
export default function FaqLoading(): React.ReactElement {
  return <PageLoadingShell label="FAQ page" />;
}
