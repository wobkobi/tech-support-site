// src/features/admin/components/ui/AdminInput.tsx
// Native input in the admin field style. Every native prop (and `ref`, a plain prop in
// React 19) passes straight through; `className` merges over the defaults. Server-safe.

import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Admin text/number/date input.
 * @param props - Native input props.
 * @param props.className - Extra classes merged over the admin field style.
 * @returns The input element.
 */
export function AdminInput({
  className,
  ...rest
}: React.ComponentProps<"input">): React.ReactElement {
  return <input {...rest} className={cn(ADMIN_INPUT_CLS, className)} />;
}
