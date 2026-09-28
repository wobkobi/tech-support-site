// src/app/admin/(shell)/contacts/[id]/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Contact route-loading spinner.
 * @returns Loading element.
 */
export default function ContactDetailLoading(): React.ReactElement {
  return <LoadingSpinner label="contact" className="min-h-[60vh]" />;
}
