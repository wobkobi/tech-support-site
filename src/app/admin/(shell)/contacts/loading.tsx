// src/app/admin/(shell)/contacts/loading.tsx

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import type React from "react";

/**
 * Contacts route-loading spinner.
 * @returns Loading element.
 */
export default function ContactsLoading(): React.ReactElement {
  return <LoadingSpinner label="contacts" className="min-h-[60vh]" />;
}
