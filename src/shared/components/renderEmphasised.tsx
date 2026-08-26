// src/shared/components/renderEmphasised.tsx
// Renders the `**bold**` convention used in pricing-policy copy, so the public
// pages that surface that copy all emphasise it the same way.

import type React from "react";

/**
 * Splits text on `**...**` and wraps those runs in `<strong>`.
 * @param text - Copy that may contain `**emphasis**` markers.
 * @returns Nodes ready to render, emphasis applied.
 */
export function renderEmphasised(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const m = part.match(/^\*\*([^*]+)\*\*$/);
    return m ? <strong key={i}>{m[1]}</strong> : <span key={i}>{part}</span>;
  });
}
