// src/features/admin/components/ui/AdminTextarea.tsx
// Native textarea in the admin field style, vertical resize only. Built on TextArea, so
// Grammarly fixes stick.

import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { TextArea } from "@/shared/components/TextArea";
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
  return <TextArea {...rest} className={cn(ADMIN_INPUT_CLS, "resize-y", className)} />;
}
