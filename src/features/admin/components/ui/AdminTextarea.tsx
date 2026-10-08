// src/features/admin/components/ui/AdminTextarea.tsx
// Native textarea in the admin field style, resizable vertically only. Every native prop
// (and `ref`, a plain prop in React 19) passes straight through; `className` merges over
// the defaults. Server-safe.

import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Admin textarea.
 * @param props - Native textarea props.
 * @param props.className - Extra classes merged over the admin field style.
 * @returns The textarea element.
 */
export function AdminTextarea({
  className,
  ...rest
}: React.ComponentProps<"textarea">): React.ReactElement {
  return <textarea {...rest} className={cn(ADMIN_INPUT_CLS, "resize-y", className)} />;
}
