// src/features/admin/components/ui/AdminSelect.tsx
// Native select in the admin field style. Every native prop (and `ref`, a plain prop in
// React 19) passes straight through; `className` merges over the defaults. Server-safe.

import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Admin select.
 * @param props - Native select props.
 * @param props.className - Extra classes merged over the admin field style.
 * @returns The select element.
 */
export function AdminSelect({
  className,
  ...rest
}: React.ComponentProps<"select">): React.ReactElement {
  return <select {...rest} className={cn(ADMIN_INPUT_CLS, className)} />;
}
