// src/shared/components/PhoneLink.tsx
// Inline tap-to-call link for "call or text me" copy. A plain <a href="tel:"> on purpose:
// GoogleTag delegates the phone_call_click event from any tel: anchor, so every use is
// tracked without wiring.

import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Props for {@link PhoneLink}. */
interface PhoneLinkProps {
  /** Display number, e.g. "021 297 1237". */
  phone: string;
  /** The identity setting's tel: URI, e.g. "tel:+64212971237", used as the href as-is. */
  phoneTel: string;
  /** Extra classes, merged over the default link styling. */
  className?: string;
}

/**
 * Inline tap-to-call link showing the display number.
 * @param props - Component props.
 * @param props.phone - Display number.
 * @param props.phoneTel - tel: URI used as the href.
 * @param props.className - Extra classes.
 * @returns The link element.
 */
export function PhoneLink({ phone, phoneTel, className }: PhoneLinkProps): React.ReactElement {
  return (
    <a
      href={phoneTel}
      className={cn(
        "font-semibold whitespace-nowrap text-russian-violet underline underline-offset-2 hover:opacity-80",
        className,
      )}
    >
      {phone}
    </a>
  );
}
